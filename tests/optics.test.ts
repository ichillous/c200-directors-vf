import { describe, expect, it } from 'vitest';
import { clampFocal, cropRect, frameGeometry, phoneHalfTan } from '../src/optics';
import { parseUserData } from '../src/userdata';
import { cleanShootName, dayNote } from '../src/store';
import sample from './fixtures/sample-data.json';

describe('frame geometry', () => {
  it('gives the full-frame equivalent and view for UHD on the C200', () => {
    expect(frameGeometry(18, 'uhd', 82)).toMatchObject({ ffEq: 26, hfov: 69, over: false });
    expect(frameGeometry(24, 'uhd', 82)).toMatchObject({ ffEq: 35, hfov: 54 });
    expect(frameGeometry(35, 'uhd', 82)).toMatchObject({ ffEq: 51, hfov: 39 });
  });

  it('uses the wider sensor area for 4K DCI', () => {
    expect(frameGeometry(18, 'dci', 82)).toMatchObject({ ffEq: 25, hfov: 72 });
    expect(frameGeometry(35, 'dci', 82)).toMatchObject({ ffEq: 48, hfov: 41 });
  });

  it('fits UHD at 18 mm inside the Pixel main camera, and flags DCI at 18 mm as too wide', () => {
    const uhd = frameGeometry(18, 'uhd', 82);
    expect(uhd.frac).toBeGreaterThan(0.97);
    expect(uhd.frac).toBeLessThan(1);
    const dci = frameGeometry(18, 'dci', 82);
    expect(dci.frac).toBe(1);
    expect(dci.over).toBe(true);
    expect(frameGeometry(19, 'dci', 82).over).toBe(false);
  });

  it('shows everything inside the ultrawide', () => {
    expect(frameGeometry(18, 'dci', 123).over).toBe(false);
  });

  it('halves the frame, roughly, between 18 and 35 mm', () => {
    const ratio = frameGeometry(35, 'uhd', 82).frac / frameGeometry(18, 'uhd', 82).frac;
    expect(ratio).toBeCloseTo(18 / 35, 5);
  });

  it('takes the horizontal view as four fifths of the diagonal on a 4:3 sensor', () => {
    expect(phoneHalfTan(90)).toBeCloseTo(0.8, 10);
  });
});

describe('crop', () => {
  it('keeps the full width of a 4:3 source and centres the frame', () => {
    const geo = frameGeometry(35, 'uhd', 82);
    const r = cropRect(4000, 3000, geo);
    expect(r.w).toBeCloseTo(4000 * geo.frac, 6);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 6);
    expect(r.x + r.w / 2).toBeCloseTo(2000, 6);
    expect(r.y + r.h / 2).toBeCloseTo(1500, 6);
  });

  it('never reads outside the source', () => {
    const r = cropRect(1920, 1080, frameGeometry(18, 'dci', 82));
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1920.0001);
    expect(r.y + r.h).toBeLessThanOrEqual(1080.0001);
  });
});

describe('helpers', () => {
  it('clamps focal lengths to the lens', () => {
    expect(clampFocal(16)).toBe(18);
    expect(clampFocal(50)).toBe(35);
    expect(clampFocal(Number.NaN)).toBe(18);
  });

  it('names shoot folders the Drive way', () => {
    expect(cleanShootName('  Park interview  day 2 ')).toBe('Park-interview-day-2');
    expect(cleanShootName('<script>')).toBe('script');
  });

  it('counts days to an upcoming shoot', () => {
    const now = new Date(2026, 10, 23);
    expect(dayNote('2026-11-26', now)).toBe('in 3 days');
    expect(dayNote('2026-11-23', now)).toBe('today');
    expect(dayNote('2026-11-22', now)).toBe('');
    expect(dayNote('2026-08', now)).toBe('');
  });
});

describe('data file', () => {
  it('reads the sample file', () => {
    const data = parseUserData(sample);
    expect(data.shoots).toHaveLength(4);
    expect(data.planned[0].shotListId).toBe('short-list');
    expect(data.shotLists[0].shots.filter((s) => s.pos > 0)).toHaveLength(4);
  });

  it('pulls shot focal lengths inside the lens range', () => {
    const data = parseUserData({ version: 1, shotLists: [{ id: 'a', title: 'A', shots: [{ no: '01', name: 'Too wide', pos: 1, lo: 16, hi: 50, first: 10 }] }] });
    expect(data.shotLists[0].shots[0]).toMatchObject({ lo: 18, hi: 35, first: 18 });
  });

  it('refuses files that are not for this app', () => {
    expect(() => parseUserData({ version: 2 })).toThrow();
    expect(() => parseUserData('nope')).toThrow();
  });
});
