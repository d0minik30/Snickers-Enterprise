// Shapes exchanged with the skyline API (backend/skyline) and the engine. Draft until
// backend/CONTRACTS.md exists; the checks below reject anything that does not look like them.

export type Sample = { az_offset_deg: number; elev_deg: number; weight: number };

export type Skyline = {
  format: string;
  camera: {
    model: 'pinhole' | 'cahvore';
    width: number; height: number; hfov_deg: number; vfov_deg: number;
    pitch_deg: number; roll_deg: number; source: string;
  };
  level_source: 'label' | 'sensor' | 'manual' | 'assumed';
  eye_height_m: number;
  time_utc: string | null;
  sun: { az_offset_deg: number; elev_deg: number } | null;
  az_step_deg: number;
  samples: Sample[];
};

/** Why a stretch of the line is not trusted. 'erased' and 'rock' are the user's own marks. */
export type Reason = 'near' | 'haze' | 'jitter' | 'edge' | 'top' | 'glare' | 'erased' | 'rock';

/** The traced line in the photo's own pixels, one point per column, left to right. */
export type Trace = {
  width: number; height: number;
  x: number[]; y: number[]; weight: number[]; reason: (Reason | null)[];
  sun_px: [number, number] | null;
};

export type SkylineResponse = { skyline: Skyline; trace: Trace; debug_image: string };

/** What the user tells us about the camera; sent to the API as the `camera` JSON. */
export type CameraSpec = {
  preset?: string;
  hfov_deg?: number;
  pitch_deg?: number;
  roll_deg?: number;
  level_source?: 'sensor' | 'manual';
  eye_height_m?: number;
  time_utc?: string;
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numArray = (v: unknown, n?: number) => Array.isArray(v) && v.every(isNum) && (n === undefined || v.length === n);

export function isSkyline(v: unknown): v is Skyline {
  if (!isObj(v) || !isObj(v.camera) || !Array.isArray(v.samples)) return false;
  const c = v.camera;
  return typeof v.format === 'string'
    && (c.model === 'pinhole' || c.model === 'cahvore')
    && [c.width, c.height, c.hfov_deg, c.vfov_deg, c.pitch_deg, c.roll_deg].every(isNum)
    && isNum(v.eye_height_m) && isNum(v.az_step_deg)
    && (v.time_utc === null || typeof v.time_utc === 'string')
    && (v.sun === null || (isObj(v.sun) && isNum(v.sun.az_offset_deg) && isNum(v.sun.elev_deg)))
    && v.samples.every(s => isObj(s) && isNum(s.az_offset_deg) && isNum(s.elev_deg) && isNum(s.weight));
}

export function isTrace(v: unknown): v is Trace {
  if (!isObj(v) || !isNum(v.width) || !isNum(v.height) || !Array.isArray(v.x)) return false;
  const n = v.x.length;
  return n >= 2 && numArray(v.x) && numArray(v.y, n) && numArray(v.weight, n)
    && Array.isArray(v.reason) && v.reason.length === n
    && v.reason.every(r => r === null || typeof r === 'string')
    && (v.sun_px === null || numArray(v.sun_px, 2));
}

export function isSkylineResponse(v: unknown): v is SkylineResponse {
  return isObj(v) && isSkyline(v.skyline) && isTrace(v.trace)
    && typeof v.debug_image === 'string' && v.debug_image.startsWith('data:image/');
}
