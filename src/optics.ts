// Lens and sensor maths. Everything the frame lines draw comes from here.

export type Format = 'uhd' | 'dci';

/** Active sensor area of the Canon C200 per recording format (6.4 µm pixel pitch). */
export const SENSOR: Record<Format, { width: number; aspect: number; name: string; short: string; media: string }> = {
  uhd: { width: 24.6, aspect: 16 / 9, name: 'UHD 16:9', short: '16:9', media: 'SD card' },
  dci: { width: 26.2, aspect: 4096 / 2160, name: 'DCI 17:9', short: '17:9', media: 'RAW on CFast' },
};

/** Sigma 18-35mm f/1.8 Art: zoom range and the focal lengths engraved on the barrel. */
export const LENS = { min: 18, max: 35, marks: [18, 20, 24, 28, 35] };

/** Google's published diagonal field of view for the Pixel 10 Pro cameras. */
export const PHONE_FOV = { main: 82, ultrawide: 123 };

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Tangent of half the phone camera's horizontal field of view.
 * Phone specs quote the diagonal angle on a 4:3 sensor, and the horizontal
 * side of a 4:3 rectangle is 4/5 of its diagonal.
 */
export function phoneHalfTan(diagonalFovDeg: number): number {
  return Math.tan(rad(diagonalFovDeg / 2)) * 0.8;
}

export interface FrameGeometry {
  /** Width of the C200 frame as a share of the phone camera's width, capped at 1. */
  frac: number;
  /** True when the C200 sees wider than the phone camera can show. */
  over: boolean;
  aspect: number;
  /** Full-frame equivalent focal length, rounded. */
  ffEq: number;
  /** Horizontal field of view in degrees, rounded. */
  hfov: number;
}

export function frameGeometry(mm: number, format: Format, phoneDiagonalFov: number): FrameGeometry {
  const sensor = SENSOR[format];
  const halfTan = sensor.width / 2 / mm;
  const raw = halfTan / phoneHalfTan(phoneDiagonalFov);
  return {
    frac: Math.min(1, raw),
    over: raw > 1.0005,
    aspect: sensor.aspect,
    ffEq: Math.round((mm * 36) / sensor.width),
    hfov: Math.round((2 * Math.atan(halfTan) * 180) / Math.PI),
  };
}

/** Clamp a focal length to what the lens can do. */
export function clampFocal(mm: number): number {
  if (!Number.isFinite(mm)) return LENS.min;
  return Math.min(LENS.max, Math.max(LENS.min, Math.round(mm)));
}

/**
 * The part of a source image (video frame or photo) that the C200 would record.
 * The source is shown with "cover" in a 16:9 box, so its full width is kept
 * unless it is wider than 16:9.
 */
export function cropRect(sourceW: number, sourceH: number, geo: FrameGeometry) {
  const boxAspect = 16 / 9;
  let visW = sourceW;
  let visH = sourceH;
  if (sourceW / sourceH > boxAspect) visW = sourceH * boxAspect;
  else visH = sourceW / boxAspect;
  const w = visW * geo.frac;
  const h = Math.min(visH, w / geo.aspect);
  return { x: (sourceW - w) / 2, y: (sourceH - h) / 2, w, h };
}
