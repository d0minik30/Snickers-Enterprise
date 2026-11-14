'use client';

import { useEffect, useRef, useState } from 'react';
import { tiltFromMotion } from '@/lib/locate/level';
import css from './locate.module.css';

export type Captured = { blob: Blob; tilt: { pitchDeg: number; rollDeg: number } | null; timeUtc: string };

type Props = { onCapture: (c: Captured) => void; onClose: () => void };

type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

const SMOOTHING = 0.2; // share of each new sensor reading in the running average

function screenAngle(): number {
  const a = typeof screen !== 'undefined' ? screen.orientation?.angle : undefined;
  return typeof a === 'number' ? a : 0;
}

/**
 * Take a photo in the app, so the phone's tilt sensor can be read at the same moment. Shows the live
 * pitch and roll; holding the phone level should read close to 0 / 0, which also checks the sensor.
 */
export function CameraCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const tiltRef = useRef<{ pitchDeg: number; rollDeg: number } | null>(null);
  const [tilt, setTilt] = useState<{ pitchDeg: number; rollDeg: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('The camera needs a secure page (https, or localhost on this computer).');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(s => {
        if (cancelled) return s.getTracks().forEach(t => t.stop());
        stream = s;
        const v = videoRef.current;
        if (v) {
          v.srcObject = s;
          void v.play().then(() => setReady(true)).catch(() => setReady(true));
        }
      })
      .catch(() => setError('No camera, or permission was refused.'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  useEffect(() => {
    const motion = (globalThis as { DeviceMotionEvent?: MotionPermission }).DeviceMotionEvent;
    if (motion && typeof motion.requestPermission === 'function') setNeedsPermission(true);
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      const t = tiltFromMotion(a.x, a.y, a.z, screenAngle());
      if (!t) return;
      const prev = tiltRef.current;
      const next = prev
        ? { pitchDeg: prev.pitchDeg + SMOOTHING * (t.pitchDeg - prev.pitchDeg), rollDeg: prev.rollDeg + SMOOTHING * (t.rollDeg - prev.rollDeg) }
        : t;
      tiltRef.current = next;
      setTilt(next);
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, []);

  const askPermission = async () => {
    const motion = (globalThis as { DeviceMotionEvent?: MotionPermission }).DeviceMotionEvent;
    try {
      const answer = await motion?.requestPermission?.();
      setNeedsPermission(answer !== 'granted');
      if (answer !== 'granted') setError('Tilt sensor refused: the photo will need levelling by hand.');
    } catch {
      setError('Could not ask for the tilt sensor.');
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')?.drawImage(v, 0, 0);
    const shotTilt = tiltRef.current; // the reading at the moment of the tap
    const timeUtc = new Date().toISOString().slice(0, 19) + 'Z';
    canvas.toBlob(blob => {
      if (blob) onCapture({ blob, tilt: shotTilt, timeUtc });
    }, 'image/jpeg', 0.92);
  };

  const level = tilt !== null && Math.abs(tilt.pitchDeg) < 1 && Math.abs(tilt.rollDeg) < 1;

  return (
    <div className={css.capture} role="dialog" aria-modal="true" aria-label="Take a photo">
      <video ref={videoRef} className={css.captureVideo} playsInline muted />
      {/* Live horizon: where level is, given the current roll. */}
      {tilt && <div className={css.captureHorizon} style={{ transform: `rotate(${-tilt.rollDeg}deg)` }} aria-hidden />}
      <div className={css.captureTop}>
        <span className={level ? css['status-ok'] : css.captureReadout} data-testid="capture-tilt">
          {tilt ? `PITCH ${tilt.pitchDeg.toFixed(1)}°  ROLL ${tilt.rollDeg.toFixed(1)}°` : 'NO TILT SENSOR'}
        </span>
        <button type="button" className={css.smallButton} onClick={onClose}>CLOSE</button>
      </div>
      {error && <p className={css.captureError} role="alert">{error}</p>}
      <div className={css.captureBottom}>
        {needsPermission && tilt === null && <button type="button" className={css.smallButton} onClick={askPermission}>ALLOW TILT SENSOR</button>}
        <button type="button" className={css.shutter} onClick={capture} disabled={!ready} aria-label="Take photo" data-testid="shutter" />
      </div>
    </div>
  );
}
