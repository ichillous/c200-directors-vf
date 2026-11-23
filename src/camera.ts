import { useEffect, useRef, useState } from 'react';

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
      setStatus('none');
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setStatus('starting');
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
          void el.play().catch(() => undefined);
        }
        setStatus('live');
        const track = st.getVideoTracks()[0];
        // Phones often start a web camera at a fixed focus. Ask for continuous autofocus where the camera offers it.
        const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[] };
        if (caps.focusMode?.includes('continuous')) {
          void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
        }
        const got = track.getSettings();
        setPicture(got.width && got.height ? `${got.width} × ${got.height}` : '');
        void navigator.mediaDevices.enumerateDevices().then((all) => {
          if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'));
        });
      })
      .catch((err: DOMException) => {
        if (cancelled) return;
        setStatus(err.name === 'NotAllowedError' || err.name === 'SecurityError' ? 'blocked' : 'none');
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, deviceId, attempt]);

  return { videoRef, status, devices, picture, retry: () => setAttempt((a) => a + 1) };
}
