import { useEffect, useRef, useState } from 'react';
import { cameraChoice, log, logError, scrub, setCameraIds } from './diag';

export type CameraStatus = 'starting' | 'live' | 'blocked' | 'none';

/** Runs the phone's back camera into a <video> while `active` is true. */
export function useCamera(active: boolean, deviceId: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [picture, setPicture] = useState('');

  useEffect(() => {
    if (!active) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      log('W', 'camera_failed', { name: 'unsupported', choice: deviceId ? 'picked' : 'auto', attempt });
      setStatus('none');
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setStatus('starting');
    // Device ids and labels are never logged; the choice is 'auto' or an index into the camera list.
    log('I', 'camera_start', { choice: cameraChoice(deviceId), attempt });
    const t0 = performance.now();
    const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const video: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId }, ...size }
      : { facingMode: { ideal: 'environment' }, ...size };
    navigator.mediaDevices
      .getUserMedia({ video, audio: false })
      .then((st) => {
        if (cancelled) {
          st.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = st;
        const el = videoRef.current;
        if (el) {
          el.srcObject = st;
          void el.play().catch((err) => logError('W', 'camera_play_failed', err));
        }
        setStatus('live');
        const track = st.getVideoTracks()[0];
        track.addEventListener('ended', () => log('W', 'camera_track_ended'));
        // Phones often start a web camera at a fixed focus. Ask for continuous autofocus where the camera offers it.
        const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[] };
        const focusContinuous = !!caps.focusMode?.includes('continuous');
        if (focusContinuous) {
          void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch((err) => logError('W', 'camera_focus_failed', err));
        }
        const got = track.getSettings();
        setPicture(got.width && got.height ? `${got.width} × ${got.height}` : '');
        const live = (count: number) => log('I', 'camera_live', {
          ms: Math.round(performance.now() - t0),
          size: got.width && got.height ? `${got.width}x${got.height}` : '?',
          fps: got.frameRate ? Math.round(got.frameRate) : undefined,
          devices: count,
          focusContinuous,
        });
        navigator.mediaDevices.enumerateDevices().then((all) => {
          const cams = all.filter((d) => d.kind === 'videoinput');
          setCameraIds(cams.map((d) => d.deviceId));
          live(cams.length);
          if (!cancelled) setDevices(cams);
        }, () => live(-1));
      })
      .catch((err: DOMException & { constraint?: string }) => {
        if (cancelled) return;
        log('E', 'camera_failed', {
          name: err?.name, msg: scrub(err?.message), constraint: err?.constraint,
          choice: deviceId ? 'picked' : 'auto', attempt, ms: Math.round(performance.now() - t0),
        });
        setStatus(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'blocked' : 'none');
      });
    return () => {
      cancelled = true;
      if (stream) log('I', 'camera_stop');
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, deviceId, attempt]);

  return { videoRef, status, devices, picture, retry: () => setAttempt((a) => a + 1) };
}
