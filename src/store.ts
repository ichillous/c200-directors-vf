import { useSyncExternalStore } from 'react';
import { clampFocal, frameGeometry, PHONE_FOV, type Format } from './optics';
import { deleteImage } from './images';
import { cameraChoice, log, logError, logSettled, notePersistFailure, registerSummary, sendLogs, startupDone } from './diag';
import { KIT_IDS, type Destination, type Frame, type Shoot, type ShotList, type UserData, type View, type Folder } from './types';

export interface State {
  view: View;
  /** Which picker sheet is open, if any. */
  menu: '' | 'dest' | 'camera' | 'showing' | 'tag' | 'file';
  focal: number;
  fmt: Format;
  dest: string;
  tag: string;
  shot: string;
  boardList: string;
  frames: Frame[];
  sel: string;
  showing: string;
  tagFilter: string;
  made: Shoot[];
  data: UserData | null;
  kit: Record<string, boolean>;
  swap: boolean;
  /** Diagonal field of view of the phone camera in use, in degrees. */
  fov: number;
  deviceId: string;
  thirds: boolean;
  toast: string;
  undo: Frame | null;
  /** Crashes found at launch since the last run. Shown on the viewfinder until logs are sent or it is dismissed. Not saved. */
  crashNote: number;
}

const KEY = 'c200vf:v1';
const SAVED: (keyof State)[] = [
  'focal', 'fmt', 'dest', 'tag', 'shot', 'boardList', 'frames', 'made', 'data', 'kit', 'swap', 'fov', 'deviceId', 'thirds',
];

const initial: State = {
  view: 'finder', menu: '', focal: 24, fmt: 'uhd', dest: 'bank', tag: '', shot: '', boardList: '',
  frames: [], sel: '', showing: 'all', tagFilter: '', made: [], data: null,
  kit: {}, swap: false, fov: PHONE_FOV.main, deviceId: '', thirds: true, toast: '', undo: null, crashNote: 0,
};

function load(): State {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return initial;
    const saved = JSON.parse(raw) as Partial<State>;
    return { ...initial, ...saved, focal: clampFocal(saved.focal ?? 24), crashNote: 0 };
  } catch (err) {
    log('E', 'state_load_failed', { name: err instanceof Error ? err.name : typeof err, bytes: raw?.length ?? 0 });
    return initial;
  }
}

let state = load();
const listeners = new Set<() => void>();

function persist() {
  let json = '';
  try {
    const out: Record<string, unknown> = {};
    for (const k of SAVED) out[k] = state[k];
    json = JSON.stringify(out);
    localStorage.setItem(KEY, json);
  } catch (err) {
    // Storage full or blocked: the app keeps working for this visit.
    notePersistFailure(err, json.length);
  }
}

/** Where a destination id points, as a kind and an index. The id itself can come from an imported file, so it is never logged. */
export function destKind(s: State, id: string): { kind: string; idx?: number } {
  if (id === 'bank') return { kind: 'bank' };
  const lists: [string, { id: string }[]][] = [['drive', s.data?.shoots ?? []], ['planned', s.data?.planned ?? []], ['made', s.made]];
  for (const [kind, arr] of lists) {
    const idx = arr.findIndex((x) => x.id === id);
    if (idx >= 0) return { kind, idx };
  }
  return { kind: 'unknown' };
}

/** Activity events for a state change, worked out by comparing before and after. */
function logChanges(prev: State, next: State) {
  if (prev.view !== next.view) log('I', 'view_change', { from: prev.view, to: next.view });
  if (prev.menu !== next.menu) {
    if (prev.menu) log('I', 'sheet_close', { menu: prev.menu });
    if (next.menu) log('I', 'sheet_open', { menu: next.menu });
  }
  if (prev.fmt !== next.fmt) log('I', 'fmt_set', { fmt: next.fmt });
  if (prev.thirds !== next.thirds) log('I', 'thirds_set', { on: next.thirds });
  if (prev.tag !== next.tag) log('I', 'tag_set', { tag: next.tag || 'none' });
  if (prev.dest !== next.dest) log('I', 'dest_set', destKind(next, next.dest));
  if (prev.deviceId !== next.deviceId) log('I', 'camera_pick', { choice: cameraChoice(next.deviceId) });
  if (prev.focal !== next.focal) logSettled('focal_set', { mm: next.focal });
  if (prev.fov !== next.fov) logSettled('fov_set', { deg: next.fov });
}

export function set(patch: Partial<State>) {
  const prev = state;
  state = { ...state, ...patch };
  try {
    logChanges(prev, state);
  } catch (err) {
    logError('W', 'log_diff_failed', err);
  }
  persist();
  listeners.forEach((l) => l());
}

registerSummary(() => ({
  view: state.view,
  frames: state.frames.length,
  framesWithImage: state.frames.filter((f) => f.hasImage).length,
  shootsImported: state.data?.shoots.length ?? 0,
  shootsMade: state.made.length,
  lists: state.data?.shotLists.length ?? 0,
  planned: state.data?.planned.length ?? 0,
  kit: `${KIT_IDS.filter((id) => state.kit[id]).length}/${KIT_IDS.length}`,
  fmt: state.fmt,
  focal: state.focal,
  fov: state.fov,
  camera: cameraChoice(state.deviceId),
  stateBytes: (() => {
    try {
      return localStorage.getItem(KEY)?.length ?? 0;
    } catch {
      return 0;
    }
  })(),
}));

// Native startup reports crashes since the last launch; the viewfinder then offers to send the logs.
void startupDone.then((r) => {
  if (r.newCrashes > 0) set({ crashNote: r.newCrashes });
});

export const get = () => state;

export function useApp(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// ---- dates ----

const two = (n: number) => String(n).padStart(2, '0');

export function todayStr(now = new Date()): string {
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** "today", "tomorrow", "in 3 days" for a full date today or later; empty otherwise. */
export function dayNote(date: string | undefined, now = new Date()): string {
  if (!date || date.length !== 10 || date < todayStr(now)) return '';
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const n = Math.round((new Date(y, m - 1, d).getTime() - start) / 86400000);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}

// ---- selectors ----

export function allShoots(s: State): Shoot[] {
  return [...(s.data?.shoots ?? []), ...s.made];
}

/** Everywhere a frame can be saved: the bank, shoots still ahead of you, and plans. */
export function destinations(s: State): Destination[] {
  const drive = s.data?.shoots ?? [];
  return [
    { id: 'bank', name: 'Shot Bank' },
    ...drive.filter((sh) => sh.ongoing || dayNote(sh.date)).map((sh) => ({ id: sh.id, name: sh.name, shotListId: sh.shotListId })),
    ...(s.data?.planned ?? []).map((p) => ({ id: p.id, name: p.name, shotListId: p.shotListId })),
    ...s.made.map((sh) => ({ id: sh.id, name: sh.name })),
  ];
}

export function destName(s: State, id: string): string {
  if (id === 'bank') return 'Shot Bank';
  const hit = destinations(s).find((d) => d.id === id) ?? allShoots(s).find((sh) => sh.id === id);
  return hit ? hit.name : 'Shot Bank';
}

export function shotListFor(s: State, destId: string): ShotList | undefined {
  const d = destinations(s).find((x) => x.id === destId);
  return d?.shotListId ? s.data?.shotLists.find((l) => l.id === d.shotListId) : undefined;
}

export const cameraShots = (list: ShotList) => list.shots.filter((sh) => sh.pos > 0);

export function currentShot(s: State, list: ShotList) {
  const cams = cameraShots(list);
  return cams.find((sh) => sh.no === s.shot) ?? cams[0];
}

export function framesFor(s: State, destId: string): number {
  return s.frames.filter((f) => f.dest === destId).length;
}

// ---- actions ----

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string) {
  clearTimeout(toastTimer);
  set({ toast: text });
  toastTimer = setTimeout(() => set({ toast: '' }), 1800);
}

export function go(view: View) {
  set({ view, menu: '' });
}

export function chooseDest(id: string) {
  const list = shotListFor({ ...state, dest: id }, id);
  if (list) {
    const shot = currentShot(state, list);
    set({ dest: id, menu: '', shot: shot.no, focal: clampFocal(shot.first) });
  } else {
    set({ dest: id, menu: '' });
  }
}

export function stepShot(dir: 1 | -1) {
  const list = shotListFor(state, state.dest);
  if (!list) return;
  const cams = cameraShots(list);
  const i = cams.findIndex((sh) => sh.no === currentShot(state, list).no);
  const n = (i + dir + cams.length) % cams.length;
  const next = cams[n];
  log('I', 'shot_step', { dir, idx: `${n}/${cams.length}` });
  set({ shot: next.no, focal: clampFocal(next.first) });
}

/** What the shutter was pointed at when it was pressed. */
export function frameSnapshot(s: State = state) {
  const list = shotListFor(s, s.dest);
  const shot = list ? currentShot(s, list) : undefined;
  return {
    mm: s.focal,
    fmt: s.fmt,
    dest: s.dest,
    tag: shot ? '' : s.tag,
    shot: shot ? shot.no : '',
    frac: frameGeometry(s.focal, s.fmt, s.fov).frac,
  };
}

export function addFrame(id: string, hasImage: boolean, snap: ReturnType<typeof frameSnapshot>): Frame {
  const frame: Frame = { id, at: Date.now(), hasImage, ...snap };
  set({ frames: [...state.frames, frame] });
  const what = snap.shot ? `shot ${snap.shot}` : snap.tag ? snap.tag : `${snap.mm} mm`;
  toast(`Saved to ${destName(state, snap.dest)}, ${what}`);
  return frame;
}

export function patchFrame(id: string, patch: Partial<Frame>) {
  if (patch.tag !== undefined) log('I', 'frame_retag', { tag: patch.tag || 'none' });
  if (patch.dest !== undefined) log('I', 'frame_refile', { kind: destKind(state, patch.dest).kind });
  set({ frames: state.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)), menu: '' });
}

export function deleteFrame(id: string) {
  const frame = state.frames.find((f) => f.id === id);
  if (!frame) return;
  // The previous deleted frame can no longer be restored, so its image goes now.
  if (state.undo?.hasImage) void deleteImage(state.undo.id);
  set({ frames: state.frames.filter((f) => f.id !== id), undo: frame, sel: '', menu: '' });
  log('I', 'frame_delete', { hadImage: frame.hasImage, total: state.frames.length });
}

export function undoDelete() {
  const frame = state.undo;
  if (!frame) return;
  log('I', 'frame_undo');
  set({ frames: [...state.frames, frame].sort((a, b) => a.at - b.at), sel: frame.id, undo: null });
}

export function reframe(frame: Frame) {
  const known = destinations(state).some((d) => d.id === frame.dest);
  log('I', 'reframe', { known });
  set({
    view: 'finder', menu: '', focal: frame.mm, fmt: frame.fmt,
    dest: known ? frame.dest : 'bank', tag: frame.tag, shot: frame.shot || state.shot,
  });
}

export function cleanShootName(name: string): string {
  return name.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '');
}

export function createShoot(folder: Folder, what: string) {
  const clean = cleanShootName(what);
  if (!clean) return;
  const date = todayStr();
  log('I', 'shoot_create', { folder, nameLen: clean.length });
  set({ made: [...state.made, { id: `u${Date.now()}`, folder, name: `${date}_${clean}`, date }] });
}

export function frameShot(listId: string, shotNo: string, first: number) {
  const dest = destinations(state).find((d) => d.shotListId === listId);
  if (!dest) return;
  const list = state.data?.shotLists.find((l) => l.id === listId);
  log('I', 'frame_shot', { idx: list ? cameraShots(list).findIndex((sh) => sh.no === shotNo) : -1 });
  set({ view: 'finder', menu: '', dest: dest.id, shot: shotNo, focal: clampFocal(first) });
}

/** Send the logs and, unless the share was cancelled or failed, clear the crash note. */
export async function sendDiagnostics() {
  const how = await sendLogs();
  if (how === 'shared' || how === 'downloaded') set({ crashNote: 0 });
  return how;
}

export function dismissCrashNote() {
  log('I', 'crash_note_dismissed');
  set({ crashNote: 0 });
}
