import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runs in plain Node: a fixed time zone and a small in-memory localStorage, set before the app modules load.
vi.hoisted(() => {
  process.env.TZ = 'America/New_York';
  const data = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
});

import { appendLocal, buildReport, flush, formatLine, LOCAL_CAP, LOCAL_KEY, readLocal, scrub, stamp } from '../src/diag';
import { chooseDest, createShoot, go, set } from '../src/store';
import { parseUserData } from '../src/userdata';

const logText = () => {
  flush();
  return readLocal();
};

beforeEach(() => {
  flush();
  localStorage.removeItem(LOCAL_KEY);
});

describe('log lines', () => {
  it('stamps local time with its offset', () => {
    expect(stamp(new Date(2026, 10, 23, 14, 2, 11, 482))).toBe('2026-11-23T14:02:11.482-05:00');
    expect(stamp(new Date(2026, 6, 4, 9, 5, 7, 3))).toBe('2026-07-04T09:05:07.003-04:00');
  });

  it('writes level, event and fields, quoting values with spaces', () => {
    const at = new Date(2026, 10, 23, 14, 2, 11, 482);
    expect(formatLine('E', 'camera_failed', { name: 'NotReadableError', msg: 'Could not start', attempt: 0, ok: false, skip: undefined, empty: '' }, at))
      .toBe('2026-11-23T14:02:11.482-05:00 E camera_failed name=NotReadableError msg="Could not start" attempt=0 ok=false empty=""');
    expect(formatLine('I', 'x', { q: 'say "hi"' }, at)).toMatch(/ q="say \\"hi\\""$/);
  });

  it('scrubs messages to one short line', () => {
    expect(scrub('first\nsecond')).toBe('first | second');
    const long = scrub('z'.repeat(900));
    expect(long.length).toBe(501);
    expect(long.endsWith('…')).toBe(true);
    expect(scrub('bad blob:https://x/1234-5678 here')).toBe('bad blob:… here');
    expect(scrub(`device ${'ab12'.repeat(16)} gone`)).toBe('device <id> gone');
    expect(scrub(new Error('boom'))).toBe('boom');
  });
});

describe('browser log store', () => {
  it('keeps the newest lines under the size cap, cut at a line start', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line-${String(i).padStart(3, '0')} ${'x'.repeat(1000)}`);
    for (let i = 0; i < lines.length; i += 10) appendLocal(lines.slice(i, i + 10));
    const kept = readLocal();
    expect(kept.length).toBeLessThanOrEqual(LOCAL_CAP);
    expect(kept.startsWith('line-')).toBe(true);
    expect(kept.endsWith(lines[149])).toBe(true);
    expect(kept).not.toContain('line-000 ');
  });
});

describe('activity from state changes', () => {
  it('logs screen changes and picker sheets', () => {
    go('bank');
    set({ menu: 'showing' });
    set({ menu: '' });
    go('finder');
    const text = logText();
    expect(text).toMatch(/ I view_change from=finder to=bank\n/);
    expect(text).toMatch(/ I sheet_open menu=showing\n/);
    expect(text).toMatch(/ I sheet_close menu=showing\n/);
    expect(text).toMatch(/ I view_change from=bank to=finder$/);
  });

  it('logs the focal length once the ring settles', () => {
    vi.useFakeTimers();
    try {
      set({ focal: 20 });
      set({ focal: 21 });
      set({ focal: 22 });
      vi.advanceTimersByTime(799);
      expect(logText()).not.toContain('focal_set');
      vi.advanceTimersByTime(1);
      const text = logText();
      expect(text.match(/focal_set/g)).toHaveLength(1);
      expect(text).toContain('focal_set mm=22');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never writes shoot names, places, ids or typed text', () => {
    const data = parseUserData({
      version: 1,
      shoots: [{ id: 'secretid', folder: 'FAMILY', name: 'Secret Garden Wedding', date: '2099-01-01', place: 'Grandma House' }],
      planned: [{ id: 'planid', name: 'Private Plan', note: 'Quiet note' }],
      shotLists: [],
    });
    set({ data });
    chooseDest('secretid');
    chooseDest('planid');
    createShoot('FRIENDS', 'Hidden Name');
    const text = logText();
    expect(text).toContain('dest_set kind=drive idx=0');
    expect(text).toContain('dest_set kind=planned idx=0');
    expect(text).toContain('shoot_create folder=FRIENDS nameLen=11');
    for (const secret of ['Secret', 'secretid', 'Grandma', 'Private', 'planid', 'Quiet', 'Hidden']) expect(text).not.toContain(secret);
  });
});

describe('report file', () => {
  it('has the header and both sections', async () => {
    go('kit');
    const { text, name } = await buildReport();
    expect(name).toMatch(/^c200vf-logs-web-\d{8}-\d{4}\.txt$/);
    expect(text).toMatch(/^C200 Viewfinder logs\n/);
    expect(text).toMatch(/App: web \(0\), commit (dev|[0-9a-f]{7})\n/);
    expect(text).toMatch(/Generated: \d{4}-\d\d-\d\dT[\d:.]+-0[45]:00 \(America\/New_York\)\n/);
    expect(text).toMatch(/Session: sid [a-z0-9]{6}, /);
    expect(text).toMatch(/State: view kit, frames 0 \(0 with image\), /);
    expect(text).toContain('Persist failures: 0');
    expect(text).toContain('Last sent: never');
    expect(text).toContain('== Crashes (last 20, oldest first) ==\n(none)');
    expect(text).toContain('== Activity log (oldest first) ==');
    expect(text).toMatch(/view_change from=\w+ to=kit/);
  });
});
