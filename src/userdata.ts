import { Capacitor } from '@capacitor/core';
import { strToU8, zipSync } from 'fflate';
import { loadImage } from './images';
import { clampFocal, frameGeometry } from './optics';
import { destName, get, todayStr } from './store';
import { FOLDERS, type Folder, type Planned, type Shoot, type Shot, type ShotList, type UserData } from './types';

// Your shoots and shot lists come in from a JSON file and stay on this device.
// Nothing personal ships with the app. README.md documents the file format.

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v: unknown, fallback: string): string => str(v, 60).replace(/[^A-Za-z0-9_-]/g, '') || fallback;

function parseShot(raw: unknown, i: number): Shot {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pos = Number.isFinite(r.pos) ? Math.max(0, Math.round(r.pos as number)) : 0;
  const lo = pos ? clampFocal(Number(r.lo)) : 0;
  const hi = pos ? Math.max(lo, clampFocal(Number(r.hi ?? r.lo))) : 0;
  const first = pos ? Math.min(hi, Math.max(lo, clampFocal(Number(r.first ?? r.lo)))) : 0;
  return {
    no: str(r.no, 6) || String(i + 1).padStart(2, '0'),
    name: str(r.name, 80) || 'Untitled shot',
    pos, lo, hi, first,
    start: str(r.start, 8) || undefined,
    sec: Number.isFinite(r.sec) ? (r.sec as number) : undefined,
    lensNote: str(r.lensNote, 80) || undefined,
  };
}

/** Check and tidy an imported file. Throws an Error with a plain-language message. */
export function parseUserData(input: unknown): UserData {
  if (!input || typeof input !== 'object') throw new Error('That file is not a viewfinder data file.');
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1) throw new Error('That file is for a different version of the app.');
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  const shotLists: ShotList[] = arr(raw.shotLists).slice(0, 20).map((l, i) => {
    const r = (l ?? {}) as Record<string, unknown>;
    const positions: Record<string, string> = {};
    for (const [k, v] of Object.entries((r.positions ?? {}) as Record<string, unknown>)) positions[str(k, 3)] = str(v, 60);
    return {
      id: id(r.id, `list${i}`),
      title: str(r.title, 60) || 'Shot list',
      summary: str(r.summary) || undefined,
      note: str(r.note) || undefined,
      positions,
      shots: arr(r.shots).slice(0, 200).map(parseShot),
    };
  });
  const listIds = new Set(shotLists.map((l) => l.id));
  const listRef = (v: unknown) => (listIds.has(str(v, 60)) ? str(v, 60) : undefined);

  const shoots: Shoot[] = arr(raw.shoots).slice(0, 300).map((sh, i) => {
    const r = (sh ?? {}) as Record<string, unknown>;
    const folder = FOLDERS.includes(r.folder as Folder) ? (r.folder as Folder) : 'PROJECTS';
    return {
      id: id(r.id, `shoot${i}`),
      folder,
      name: str(r.name, 80) || 'Unnamed shoot',
      date: /^\d{4}-\d{2}(-\d{2})?$/.test(str(r.date)) ? str(r.date) : undefined,
      place: str(r.place, 80) || undefined,
      ongoing: r.ongoing === true || undefined,
      nested: r.nested === true || undefined,
      shotListId: listRef(r.shotListId),
    };
  });
  const planned: Planned[] = arr(raw.planned).slice(0, 50).map((p, i) => {
    const r = (p ?? {}) as Record<string, unknown>;
    return { id: id(r.id, `plan${i}`), name: str(r.name, 80) || 'Unnamed plan', note: str(r.note, 60) || undefined, shotListId: listRef(r.shotListId) };
  });
  return { version: 1, shoots, planned, shotLists };
}

export async function readUserDataFile(file: File): Promise<UserData> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('That file could not be read as JSON.');
  }
  return parseUserData(json);
}

/** Zip of every frame's image plus frames.json, for handing to Claude or backing up. */
export async function exportFrames(): Promise<{ blob: Blob; name: string; count: number }> {
  const s = get();
  const files: Record<string, Uint8Array> = {};
  const rows = [];
  for (const f of s.frames) {
    const geo = frameGeometry(f.mm, f.fmt, s.fov);
    const file = f.hasImage ? `frames/${f.id}.jpg` : null;
    if (file) {
      const blob = await loadImage(f.id);
      if (blob) files[file] = new Uint8Array(await blob.arrayBuffer());
    }
    rows.push({
      id: f.id,
      file,
      focalLengthMm: f.mm,
      fullFrameEquivalentMm: geo.ffEq,
      horizontalViewDeg: geo.hfov,
      format: f.fmt === 'dci' ? '4K DCI 17:9' : 'UHD 16:9',
      tag: f.tag || null,
      shot: f.shot || null,
      savedTo: destName(s, f.dest),
      capturedAt: new Date(f.at).toISOString(),
    });
  }
  files['frames.json'] = strToU8(JSON.stringify({ camera: 'Canon C200', lens: 'Sigma 18-35mm f/1.8 Art', frames: rows }, null, 2));
  const zipped = zipSync(files, { level: 0 });
  return { blob: new Blob([zipped], { type: 'application/zip' }), name: `c200-frames-${todayStr()}.zip`, count: rows.length };
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Hand a file to the person: the Android share sheet in the installed app,
 * a normal download in a browser.
 */
export async function saveFile(blob: Blob, name: string): Promise<'shared' | 'downloaded'> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const written = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
    await Share.share({ title: name, files: [written.uri] });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}
