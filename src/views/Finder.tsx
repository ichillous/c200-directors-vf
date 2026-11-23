import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useCamera } from '../camera';
import { saveImage } from '../images';
import { cropRect, frameGeometry, LENS, PHONE_FOV, SENSOR, type Format } from '../optics';
import { addFrame, chooseDest, frameSnapshot, currentShot, destinations, destName, go, set, shotListFor, stepShot, useApp } from '../store';
import { TAGS } from '../types';
import { Icon, ICONS, Option, PickerButton, Sheet } from '../ui';

// Ring geometry at the app's base size: 18 mm sits 16 px in, 35 mm sits 16 px from the far end.
const ringX = (mm: number) => 16 + ((mm - LENS.min) / (LENS.max - LENS.min)) * 528;
const TICKS = Array.from({ length: LENS.max - LENS.min + 1 }, (_, i) => LENS.min + i);

export function Finder() {
  const s = useApp();
  const [photo, setPhoto] = useState('');
  const [photoFailed, setPhotoFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const cam = useCamera(!photo, s.deviceId);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);

  const geo = frameGeometry(s.focal, s.fmt, s.fov);
  const list = shotListFor(s, s.dest);
  const shot = list ? currentShot(s, list) : undefined;
  const live = !photo && cam.status === 'live';

  const hint = photoFailed
    ? 'That photo could not be opened. Try another one.'
    : photo
      ? ''
      : cam.status === 'starting'
        ? 'Starting the camera.'
        : cam.status === 'blocked'
          ? Capacitor.isNativePlatform()
            ? 'The camera is blocked. Allow it for C200 Viewfinder in Android settings, or load a photo.'
            : 'The camera is blocked. Allow it in the browser’s site settings, or load a photo.'
          : cam.status === 'none'
            ? 'No camera on this device. Load a landscape photo taken at 1x to test the lines.'
            : '';

  function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoFailed(false);
    setPhoto(URL.createObjectURL(file));
  }

  async function capture() {
    const id = `f${Date.now()}`;
    // Settings are read now, at the press, so changing them while the picture saves cannot alter this frame.
    const snap = frameSnapshot(s);
    const video = cam.videoRef.current;
    // Just switched to this screen? Give the camera a moment to deliver its first picture.
    if (!photo && cam.status !== 'blocked' && cam.status !== 'none') {
      for (let i = 0; i < 20 && !video?.videoWidth; i += 1) await new Promise((r) => setTimeout(r, 100));
    }
    const img = imgRef.current;
    let source: CanvasImageSource | null = null;
    let sw = 0;
    let sh = 0;
    if (photo && img?.naturalWidth) {
      source = img; sw = img.naturalWidth; sh = img.naturalHeight;
    } else if (!photo && video?.videoWidth) {
      source = video; sw = video.videoWidth; sh = video.videoHeight;
    }
    let blob: Blob | null = null;
    if (source) {
      const r = cropRect(sw, sh, geo);
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(1600, Math.round(r.w));
      canvas.height = Math.round((canvas.width * r.h) / r.w);
      canvas.getContext('2d')?.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
    }
    if (blob) {
      try {
        await saveImage(id, blob);
      } catch {
        blob = null; // Storage refused the picture: keep the frame's numbers anyway.
      }
    }
    addFrame(id, !!blob, snap);
  }

  const band = shot ? (shot.lo === shot.hi ? { left: ringX(shot.lo) - 4, width: 8 } : { left: ringX(shot.lo), width: ringX(shot.hi) - ringX(shot.lo) }) : null;
  const saved = s.frames.length;
  const lensText = shot ? (shot.lensNote ?? (shot.lo === shot.hi ? `${shot.lo} mm` : `${shot.lo} to ${shot.hi} mm`)) : '';

  return (
    <div className="finder">
      <div className="finder__left">
        <div className="view">
          <video ref={cam.videoRef} className="view__src" playsInline muted autoPlay hidden={!live} />
          {photo && <img ref={imgRef} className="view__src" src={photo} alt="The reference photo you loaded" onError={() => { setPhoto(''); setPhotoFailed(true); }} />}
          <div className="view__frame" style={{ width: `${geo.frac * 100}%`, aspectRatio: String(geo.aspect) }}>
            {s.thirds && (
              <>
                <div className="view__third" style={{ left: '33.333%', top: 0, bottom: 0, width: 1 }} />
                <div className="view__third" style={{ left: '66.666%', top: 0, bottom: 0, width: 1 }} />
                <div className="view__third" style={{ top: '33.333%', left: 0, right: 0, height: 1 }} />
                <div className="view__third" style={{ top: '66.666%', left: 0, right: 0, height: 1 }} />
              </>
            )}
            <span className="view__frame-name tagline">C200 frame, {SENSOR[s.fmt].short}</span>
          </div>
          {hint && <span className="view__hint tagline" role="status">{hint}</span>}
          {geo.over && <span className="view__wide" role="status">Wider than this phone camera can show. Switch to the ultrawide.</span>}
          <button type="button" className="view__phone" onClick={() => set({ menu: 'camera' })}>Phone camera, {s.fov}°</button>
          <div className="view__actions">
            {photo && <button type="button" className="btn btn--light" onClick={() => setPhoto('')}>Use the camera</button>}
            {!photo && cam.status === 'blocked' && <button type="button" className="btn btn--light" onClick={cam.retry}>Try again</button>}
            <label className="btn btn--light">
              <Icon d={ICONS.camera} />
              <span>{photo ? 'Change photo' : 'Load a photo'}</span>
              <input className="visually-hidden" type="file" accept="image/*" onChange={onPhoto} />
            </label>
          </div>
          {s.toast && <div className="view__toast" role="status">{s.toast}</div>}
        </div>

        <div className="ring">
          <div className="ring__ribs" />
          {band && <div className="ring__band" style={band} />}
          {TICKS.map((mm) => <div key={mm} className={`ring__tick ${LENS.marks.includes(mm) ? 'is-major' : ''}`} style={{ left: ringX(mm) }} />)}
          {LENS.marks.map((mm) => <span key={mm} className={`ring__mark ${mm === s.focal ? 'is-on' : ''}`} style={{ left: ringX(mm) }}>{mm}</span>)}
          <div className="ring__index" style={{ left: ringX(s.focal) }} />
          <div className="ring__cap" style={{ left: ringX(s.focal) }} />
          <input type="range" min={LENS.min} max={LENS.max} step={1} value={s.focal} aria-label="Focal length on the Sigma 18 to 35, in millimetres" onChange={(e) => set({ focal: Number(e.target.value) })} />
        </div>
      </div>

      <div className="finder__right">
        <div className="readout">
          <div className="readout__mm">
            <span className="readout__num">{s.focal}</span>
            <span className="readout__unit">mm</span>
          </div>
          <div className="readout__more">
            <span>≈ {geo.ffEq} mm full-frame</span>
            <span>{geo.hfov}° across</span>
          </div>
        </div>

        <div className="formats" role="group" aria-label="C200 recording format">
          {(Object.keys(SENSOR) as Format[]).map((id) => (
            <button key={id} type="button" className={`chip ${s.fmt === id ? 'is-on' : ''}`} aria-pressed={s.fmt === id} onClick={() => set({ fmt: id })}>
              <span>{SENSOR[id].name}</span>
              <small>{SENSOR[id].media}</small>
            </button>
          ))}
        </div>

        <div className="stack">
          <span className="label">Save to</span>
          <PickerButton label={destName(s, s.dest)} onClick={() => set({ menu: 'dest' })} />
        </div>

        {shot && list ? (
          <div className="stack">
            <span className="label">Shot from the {list.title} list</span>
            <div className="shotpick">
              <div className="shotpick__row">
                <button type="button" className="shotpick__step" aria-label="Previous shot" onClick={() => stepShot(-1)}><Icon d={ICONS.left} /></button>
                <button type="button" className="shotpick__name" aria-label={`Shot ${shot.no}, ${shot.name}. Open the shot board`} onClick={() => { set({ boardList: list.id }); go('board'); }}>
                  <b>{shot.no}</b>
                  <span className="clip">{shot.name}</span>
                </button>
                <button type="button" className="shotpick__step" aria-label="Next shot" onClick={() => stepShot(1)}><Icon d={ICONS.right} /></button>
              </div>
              <span className="shotpick__line clip">Position {shot.pos}{list.positions[shot.pos] ? `, ${list.positions[shot.pos].toLowerCase()}` : ''}</span>
              <span className="shotpick__line clip">Planned at {lensText}</span>
            </div>
          </div>
        ) : (
          <div className="stack">
            <span className="label">Tag, if you know it</span>
            <div className="tags" role="group" aria-label="Tag">
              {TAGS.map((name) => (
                <button key={name} type="button" className={`chip ${s.tag === name ? 'is-on' : ''}`} aria-pressed={s.tag === name} onClick={() => set({ tag: s.tag === name ? '' : name })}>{name}</button>
              ))}
            </div>
          </div>
        )}

        <div className="shutter-row">
          <button type="button" className="btn btn--quiet" onClick={() => go('bank')}>{saved === 0 ? 'No frames' : `${saved} saved`}</button>
          <button type="button" className="shutter" aria-label="Capture this frame" onClick={() => void capture()}><span /></button>
          <span style={{ width: 78 }} />
        </div>

        {s.menu === 'dest' && (
          <Sheet title="Save to" onClose={() => set({ menu: '' })}>
            <div role="listbox" aria-label="Save to" className="stack">
              {destinations(s).map((d) => <Option key={d.id} name={d.name} on={s.dest === d.id} onPick={() => chooseDest(d.id)} />)}
            </div>
          </Sheet>
        )}

        {s.menu === 'camera' && (
          <Sheet title="Phone camera" onClose={() => set({ menu: '' })}>
            <span className="sheet__label">How wide this camera sees, corner to corner</span>
            <div className="stepper">
              <button type="button" className="btn" aria-label="Narrower by one degree" onClick={() => set({ fov: Math.max(40, s.fov - 1) })}>−</button>
              <output>{s.fov}°</output>
              <button type="button" className="btn" aria-label="Wider by one degree" onClick={() => set({ fov: Math.min(140, s.fov + 1) })}>+</button>
            </div>
            <div className="detail__row">
              <button type="button" className={`chip ${s.fov === PHONE_FOV.main ? 'is-on' : ''}`} onClick={() => set({ fov: PHONE_FOV.main })}>Main, {PHONE_FOV.main}°</button>
              <button type="button" className={`chip ${s.fov === PHONE_FOV.ultrawide ? 'is-on' : ''}`} onClick={() => set({ fov: PHONE_FOV.ultrawide })}>Ultrawide, {PHONE_FOV.ultrawide}°</button>
            </div>
            <p className="sheet__note">Pixel 10 Pro figures. If the lines look tighter or wider than the C200’s picture, nudge the angle until they match.{cam.picture ? ` The camera is sending ${cam.picture}.` : ''}</p>
            {cam.devices.length > 1 && (
              <>
                <span className="sheet__label">Which camera</span>
                <Option name="Back camera, automatic" on={s.deviceId === ''} onPick={() => set({ deviceId: '' })} />
                {cam.devices.map((d, i) => <Option key={d.deviceId} name={d.label || `Camera ${i + 1}`} on={s.deviceId === d.deviceId} onPick={() => set({ deviceId: d.deviceId })} />)}
              </>
            )}
            <span className="sheet__label">Overlay</span>
            <Option name={s.thirds ? 'Thirds lines are on' : 'Thirds lines are off'} on={s.thirds} onPick={() => set({ thirds: !s.thirds })} />
          </Sheet>
        )}
      </div>
    </div>
  );
}
