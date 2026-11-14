// Levelling maths for the app, the same conventions as backend/skyline/level.py:
// pinhole camera frame x right, y down, z forward; pitch = optical axis above the horizon (up +);
// roll = rotation about the optical axis, + when the camera's right side dips.

export type Vec3 = [number, number, number];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Direction of gravity in the camera frame. */
export function gravityFromPitchRoll(pitchDeg: number, rollDeg: number): Vec3 {
  const p = rad(pitchDeg);
  const r = rad(rollDeg);
  return [Math.sin(r) * Math.cos(p), Math.cos(r) * Math.cos(p), -Math.sin(p)];
}

export function pitchRollFromGravity(g: Vec3): { pitchDeg: number; rollDeg: number } {
  const n = norm(g);
  return { pitchDeg: deg(Math.asin(Math.max(-1, Math.min(1, -n[2])))), rollDeg: deg(Math.atan2(n[0], n[1])) };
}

/** Pinhole camera from a horizontal field of view; square pixels, principal point at the centre. */
export type Pinhole = { width: number; height: number; f: number; cx: number; cy: number };

export function pinhole(width: number, height: number, hfovDeg: number): Pinhole {
  return { width, height, f: width / 2 / Math.tan(rad(hfovDeg) / 2), cx: (width - 1) / 2, cy: (height - 1) / 2 };
}

/**
 * The true horizon (elevation 0) as photo pixels, for a camera with this pitch and roll: the guide the
 * user lines up with a flat, distant horizon when levelling a photo by hand. Points behind the camera or
 * far outside the photo are left out.
 */
export function levelLine(cam: Pinhole, pitchDeg: number, rollDeg: number, steps = 48): [number, number][] {
  const z = gravityFromPitchRoll(pitchDeg, rollDeg);
  const fwd: Vec3 = [0, 0, 1];
  const xAxis = norm([fwd[0] - dot(fwd, z) * z[0], fwd[1] - dot(fwd, z) * z[1], fwd[2] - dot(fwd, z) * z[2]]);
  const yAxis = cross(z, xAxis);
  const half = deg(Math.atan((cam.width / 2) / cam.f)) + 10;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const az = rad(-half + (2 * half * i) / steps);
    // Horizontal direction at azimuth az in the level frame, expressed in camera coordinates.
    const d: Vec3 = [
      Math.cos(az) * xAxis[0] + Math.sin(az) * yAxis[0],
      Math.cos(az) * xAxis[1] + Math.sin(az) * yAxis[1],
      Math.cos(az) * xAxis[2] + Math.sin(az) * yAxis[2],
    ];
    if (d[2] <= 0.05) continue;
    const u = cam.f * (d[0] / d[2]) + cam.cx;
    const v = cam.f * (d[1] / d[2]) + cam.cy;
    if (u < -cam.width || u > 2 * cam.width || v < -cam.height || v > 2 * cam.height) continue;
    pts.push([u, v]);
  }
  return pts;
}

/**
 * Pitch and roll of the phone's back camera from a DeviceMotionEvent's accelerationIncludingGravity
 * (device frame: x right, y up the screen, z out of the screen; at rest it points UP, against gravity)
 * and the screen's rotation (screen.orientation.angle, counter-clockwise, degrees). The photo is taken
 * in the screen's orientation, so the screen's axes are the photo's axes.
 */
export function tiltFromMotion(ax: number, ay: number, az: number, screenAngleDeg: number): { pitchDeg: number; rollDeg: number } | null {
  const len = Math.hypot(ax, ay, az);
  if (!Number.isFinite(len) || len < 1) return null; // no sensor data, or in free fall
  const g: Vec3 = [-ax / len, -ay / len, -az / len]; // gravity, device frame
  const t = rad(screenAngleDeg);
  const sx = Math.cos(t) * g[0] - Math.sin(t) * g[1];
  const sy = Math.sin(t) * g[0] + Math.cos(t) * g[1];
  // Back camera: right = screen right, down = screen down (-y), forward = into the scene (-z).
  return pitchRollFromGravity([sx, -sy, -g[2]]);
}
