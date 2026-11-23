import { Capacitor, registerPlugin } from '@capacitor/core';
import { saveFile } from './files';

// Activity and crash log. Imported first in main.tsx so its hooks are in place before anything else runs.
// Lines look like: 2026-11-23T14:02:11.482-05:00 E event k=v k="a b"
// Never log names, places, notes, typed text, toast text, imported ids, camera ids or labels,
// image data or file names. Use kinds, indexes, counts and lengths instead.

export type Level = 'I' | 'W' | 'E';
export type Fields = Record<string, string | number | boolean | null | undefined>;

// ---- native <-> JS contract ----

export interface DiagInfo {
  versionName: string;
  versionCode: number;
  manufacturer: string;
  model: string;
  androidRelease: string;
  sdk: number;
  securityPatch: string;
  webviewPackage: string;
  webviewVersion: string;
  memTotal: number;
  memAvail: number;
  lowMemory: boolean;
  cameraGranted: boolean;
  processUptimeMs: number;
  /** ms since epoch, or 0 when never sent. */
  lastSentAt: number;
}

export interface DiagExit {
  reason: string;
  description: string;
  at: number;
}

export interface DiagStartup {
  cold: boolean;
  lastExit: DiagExit | null;
  newCrashes: number;
  crashSummaries: string[];
}

export interface DiagnosticsPlugin {
  info(): Promise<DiagInfo>;
  startup(): Promise<DiagStartup>;
  append(options: { lines: string[] }): Promise<void>;
  readLogs(): Promise<{ crashes: string; activity: string }>;
  markSent(): Promise<void>;
}

const Diagnostics = registerPlugin<DiagnosticsPlugin>('Diagnostics');

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};
const hasWindow = typeof window !== 'undefined';
const COMMIT = typeof __COMMIT__ !== 'undefined' ? __COMMIT__ : 'dev';

// ---- formatting ----

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Local time with its UTC offset, to the millisecond. */
export function stamp(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Make an error message safe and short: one line, at most `max` chars, no blob/data URLs or long hex ids. */
export function scrub(text: unknown, max = 500): string {
  let s = typeof text === 'string' ? text : text instanceof Error ? text.message : String(text ?? '');
  s = s
    .replace(/\r?\n/g, ' | ')
    .replace(/blob:\S+/g, 'blob:…')
    .replace(/data:[^\s,]*,\S*/g, 'data:…')
    .replace(/\b[0-9a-fA-F]{32,}\b/g, '<id>');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function value(v: string | number | boolean): string {
  const s = String(v).replace(/\r?\n/g, ' | ');
  return s === '' || /[\s"=]/.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
}

export function formatLine(level: Level, event: string, fields: Fields = {}, at = new Date()): string {
  let line = `${stamp(at)} ${level} ${event}`;
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    line += ` ${k}=${value(v)}`;
  }
  return line;
}

// ---- buffer and flush ----

export const LOCAL_KEY = 'c200vf:log';
const LOCAL_SENT_KEY = 'c200vf:logsent';
export const LOCAL_CAP = 100 * 1024;
const FLUSH_MS = 2000;
const FLUSH_LINES = 50;

let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
/** This session's recent lines, to fill any gap if the native writer is a moment behind. */
const tail: string[] = [];
/** Lines kept in memory when there is no localStorage at all. */
let memoryLog = '';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Browser fallback: keep the newest LOCAL_CAP characters, cut at a line start. If storage is full, drop log lines, never app state. */
export function appendLocal(lines: string[]) {
  const store = storage();
  const old = store ? (() => { try { return store.getItem(LOCAL_KEY) ?? ''; } catch { return ''; } })() : memoryLog;
  let next = old ? `${old}\n${lines.join('\n')}` : lines.join('\n');
  if (next.length > LOCAL_CAP) {
    const cut = next.indexOf('\n', next.length - LOCAL_CAP);
    next = cut < 0 ? next.slice(-LOCAL_CAP) : next.slice(cut + 1);
  }
  if (!store) {
    memoryLog = next;
    return;
  }
  for (let i = 0; i < 3; i += 1) {
    try {
      store.setItem(LOCAL_KEY, next);
      return;
    } catch {
      // Full: keep the newer half and try again.
      const cut = next.indexOf('\n', Math.floor(next.length / 2));
      if (cut < 0) break;
      next = next.slice(cut + 1);
    }
  }
}

export function readLocal(): string {
  const store = storage();
  if (!store) return memoryLog;
  try {
    return store.getItem(LOCAL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function flush() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (pending.length === 0) return;
  const lines = pending;
  pending = [];
  if (isNative()) {
    Diagnostics.append({ lines }).catch(() => appendLocal(lines));
  } else {
    appendLocal(lines);
  }
}

export function log(level: Level, event: string, fields: Fields = {}) {
  let line: string;
  try {
    line = formatLine(level, event, fields);
  } catch {
    return;
  }
  pending.push(line);
  tail.push(line);
  if (tail.length > 300) tail.splice(0, tail.length - 300);
  if (level === 'E' || pending.length >= FLUSH_LINES) flush();
  else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

/** Log an error event with its name and a scrubbed message. */
export function logError(level: Level, event: string, err: unknown, fields: Fields = {}) {
  const e = err as { name?: unknown; message?: unknown } | null;
  log(level, event, { name: typeof e?.name === 'string' ? e.name : typeof err, msg: scrub(e?.message ?? err), ...fields });
}

// ---- debounced values ----

const debounced = new Map<string, ReturnType<typeof setTimeout>>();

/** Log `event` once the value has stopped changing for `ms`. */
export function logSettled(event: string, fields: Fields, ms = 800) {
  clearTimeout(debounced.get(event));
  debounced.set(event, setTimeout(() => {
    debounced.delete(event);
    log('I', event, fields);
  }, ms));
}

// ---- hooks the rest of the app fills in ----

let summary: () => Fields = () => ({});
/** store.ts registers a function that describes the app state in counts only. */
export function registerSummary(fn: () => Fields) {
  summary = fn;
}

let cameraIds: string[] = [];
/** camera.ts reports the camera list so a choice can be logged as an index, never as an id. */
export function setCameraIds(ids: string[]) {
  cameraIds = ids;
}
export function cameraChoice(deviceId: string): string {
  if (!deviceId) return 'auto';
  const i = cameraIds.indexOf(deviceId);
  return i < 0 ? 'idx:?' : `idx:${i}`;
}

let persistFailures = 0;
export function notePersistFailure(err: unknown, bytes: number) {
  persistFailures += 1;
  if (persistFailures === 1) logError('E', 'state_persist_failed', err, { bytes });
}

// ---- startup ----

const webStartup: DiagStartup = { cold: true, lastExit: null, newCrashes: 0, crashSummaries: [] };
const sid = Array.from({ length: 6 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]).join('');
const sessionStart = Date.now();
let lastExit: DiagExit | null = null;

function runStartup(): Promise<DiagStartup> {
  const got = isNative() ? Diagnostics.startup().catch((err) => { logError('E', 'diag_startup_failed', err); return webStartup; }) : Promise.resolve(webStartup);
  return got.then((r) => {
    lastExit = r.lastExit;
    log('I', 'session_start', { sid, cold: r.cold, lastExit: r.lastExit?.reason ?? 'none', newCrashes: r.newCrashes });
    return r;
  });
}

/** Resolves once native startup has run: how many crashes since the last launch. */
export const startupDone: Promise<DiagStartup> = hasWindow ? runStartup() : Promise.resolve(webStartup);

// ---- global hooks ----

const fileOf = (src: string) => src.split(/[?#]/)[0].split('/').pop() || src;

function install() {
  window.addEventListener('error', (e) => {
    const err = e.error as Error | undefined;
    log('E', 'js_error', {
      msg: scrub(e.message || err?.message),
      src: e.filename ? `${fileOf(e.filename)}:${e.lineno}:${e.colno}` : undefined,
      stack: err?.stack ? scrub(err.stack, 4096) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | undefined;
    log('E', 'unhandled_rejection', {
      name: r instanceof Error ? r.name : typeof r,
      msg: scrub(r instanceof Error ? r.message : r),
      stack: r instanceof Error && r.stack ? scrub(r.stack, 4096) : undefined,
    });
  });

  // console.error / console.warn, at most 20 a minute.
  let windowStart = 0;
  let count = 0;
  for (const kind of ['error', 'warn'] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...args: unknown[]) => {
      original(...args);
      const now = Date.now();
      if (now - windowStart > 60000) {
        windowStart = now;
        count = 0;
      }
      if (count >= 20) return;
      count += 1;
      const text = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : typeof a === 'object' ? '[object]' : String(a))).join(' ');
      log(kind === 'error' ? 'E' : 'W', `console_${kind}`, { msg: scrub(text) });
    };
  }

  // Main-thread stall watchdog.
  let last = performance.now();
  let lastStall = 0;
  setInterval(() => {
    const now = performance.now();
    const drift = now - last - 500;
    last = now;
    if (drift > 2000 && !document.hidden && now - lastStall > 10000) {
      lastStall = now;
      log('W', 'main_thread_stall', { ms: Math.round(drift), view: summary().view as string | undefined });
    }
  }, 500);

  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    if (document.hidden) flush();
  });
  window.addEventListener('pagehide', flush);
}

if (hasWindow) install();

// ---- report ----

async function info(): Promise<DiagInfo> {
  if (isNative()) {
    try {
      return await Diagnostics.info();
    } catch (err) {
      logError('W', 'diag_info_failed', err);
    }
  }
  const store = storage();
  let lastSentAt = 0;
  try {
    lastSentAt = Number(store?.getItem(LOCAL_SENT_KEY) ?? 0) || 0;
  } catch {
    // ignore
  }
  return {
    versionName: 'web', versionCode: 0, manufacturer: '', model: 'browser', androidRelease: '', sdk: 0, securityPatch: '',
    webviewPackage: '', webviewVersion: '', memTotal: 0, memAvail: 0, lowMemory: false, cameraGranted: false,
    processUptimeMs: Math.round(hasWindow ? performance.now() : 0), lastSentAt,
  };
}

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);
const mins = (ms: number) => (ms >= 60000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)} s`);
const when = (ms: number) => (ms ? stamp(new Date(ms)) : 'never');

function fileStamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Add this session's newest lines if the native file does not have them yet. */
function withTail(activity: string): string {
  if (tail.length === 0) return activity;
  let from = 0;
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    if (activity.includes(tail[i])) {
      from = i + 1;
      break;
    }
  }
  const missing = tail.slice(from);
  if (missing.length === 0) return activity;
  return activity ? `${activity.replace(/\n+$/, '')}\n${missing.join('\n')}` : missing.join('\n');
}

export async function buildReport(): Promise<{ text: string; name: string }> {
  flush();
  const i = await info();
  let crashes = '';
  let activity = '';
  if (isNative()) {
    try {
      const got = await Diagnostics.readLogs();
      crashes = got.crashes;
      activity = withTail(got.activity);
    } catch (err) {
      logError('E', 'diag_read_failed', err);
      activity = withTail(readLocal());
    }
  } else {
    activity = readLocal();
  }

  const st = summary();
  const now = new Date();
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return '';
    }
  })();
  let usage = '';
  try {
    const est = hasWindow ? await navigator.storage?.estimate?.() : undefined;
    if (est?.usage !== undefined && est.quota) usage = `used ${kb(est.usage)} of ${kb(est.quota)}`;
  } catch {
    // ignore
  }
  let cameraPerm = isNative() ? (i.cameraGranted ? 'granted' : 'not granted') : 'unknown';
  if (!isNative() && hasWindow) {
    try {
      const p = await navigator.permissions?.query({ name: 'camera' as PermissionName });
      if (p) cameraPerm = p.state;
    } catch {
      // Some browsers cannot be asked.
    }
  }
  const heap = hasWindow ? (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize : undefined;
  const w = hasWindow ? window.innerWidth : 0;
  const h = hasWindow ? window.innerHeight : 0;
  const dpr = hasWindow ? window.devicePixelRatio : 1;
  const scale = w && h ? Math.min(w / 916, h / 412) : 0;
  const exit = lastExit ? `${lastExit.reason}${lastExit.description ? ` (${scrub(lastExit.description, 200)})` : ''}${lastExit.at ? ` at ${when(lastExit.at)}` : ''}` : 'none';

  const header = [
    'C200 Viewfinder logs',
    `App: ${i.versionName} (${i.versionCode}), commit ${COMMIT}`,
    `Generated: ${stamp(now)}${tz ? ` (${tz})` : ''}`,
    `Device: ${[i.manufacturer, i.model].filter(Boolean).join(' ') || 'unknown'}`,
    isNative()
      ? `Android: ${i.androidRelease} (SDK ${i.sdk}), security patch ${i.securityPatch || 'unknown'}`
      : `Browser: ${hasWindow ? scrub(navigator.userAgent, 300) : 'none'}`,
    `WebView: ${i.webviewPackage ? `${i.webviewPackage} ${i.webviewVersion}` : 'n/a'}`,
    `Session: sid ${sid}, up ${mins(Date.now() - sessionStart)}, process up ${mins(i.processUptimeMs)}, last exit ${exit}`,
    `Screen: ${w} x ${h} CSS px, dpr ${dpr}, scale ${scale.toFixed(2)}`,
    `State: view ${st.view ?? '?'}, frames ${st.frames ?? 0} (${st.framesWithImage ?? 0} with image), shoots ${st.shootsImported ?? 0} imported / ${st.shootsMade ?? 0} made, lists ${st.lists ?? 0}, kit ${st.kit ?? '?'}, fmt ${st.fmt ?? '?'}, focal ${st.focal ?? '?'} mm, fov ${st.fov ?? '?'}°, camera ${st.camera ?? '?'}`,
    `Storage: ${usage || 'unknown'}, state ${kb(Number(st.stateBytes ?? 0))}, log ${kb(activity.length + crashes.length)}`,
    `Memory: ${i.memTotal ? `device ${kb(i.memTotal)} total, ${kb(i.memAvail)} free, low ${i.lowMemory ? 'yes' : 'no'}` : 'device unknown'}${heap ? `, JS heap ${kb(heap)}` : ''}`,
    `Camera permission: ${cameraPerm}`,
    `Persist failures: ${persistFailures}`,
    `Last sent: ${when(i.lastSentAt)}`,
  ];

  const text = [
    ...header,
    '',
    '== Crashes (last 20, oldest first) ==',
    crashes.trim() || '(none)',
    '',
    '== Activity log (oldest first) ==',
    activity.trim() || '(empty)',
    '',
  ].join('\n');
  return { text, name: `c200vf-logs-${i.versionName}-${fileStamp(now)}.txt` };
}

export type SendResult = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/** Build the .txt and hand it over: the share sheet on the phone, a download in a browser. */
export async function sendLogs(): Promise<SendResult> {
  let built: { text: string; name: string };
  try {
    built = await buildReport();
  } catch (err) {
    logError('E', 'logs_send_failed', err, { stage: 'build' });
    return 'failed';
  }
  const blob = new Blob([built.text], { type: 'text/plain' });
  try {
    const how = await saveFile(blob, built.name);
    log('I', 'share_result', { result: how, what: 'logs' });
    if (how === 'cancelled') return how;
    if (isNative()) {
      await Diagnostics.markSent().catch((err) => logError('W', 'diag_mark_failed', err));
    } else {
      try {
        storage()?.setItem(LOCAL_SENT_KEY, String(Date.now()));
      } catch {
        // ignore
      }
    }
    log('I', 'logs_sent', { bytes: blob.size });
    flush();
    return how;
  } catch (err) {
    logError('E', 'logs_send_failed', err, { stage: (err as { stage?: string })?.stage ?? 'share' });
    return 'failed';
  }
}
