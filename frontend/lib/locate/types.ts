// Shapes exchanged with the engine server, following backend/CONTRACTS.md (contract_version 0.1):
// section 2 (one photo of the POST /locate body), section 3 (its result), plus the skyline API's own
// extras (diagnostics, trace). The checks below reject anything that does not look like them, so the
// app never draws a malformed answer.

export const CONTRACT_VERSION = '0.1';

export type Sample = { az_offset_deg: number; elev_deg: number; weight: number };

/** CONTRACTS.md section 2: one photo of the POST /locate body, without its id. */
export type ContractPhoto = {
  camera: {
    hfov_deg: number; vfov_deg: number; width_px: number; height_px: number;
    lens_model: 'rectilinear' | 'fisheye_equidistant' | 'cylindrical' | 'other';
  };
  eye_height_m: number;
  horizon_uncertainty_deg: number;
  relative_heading_deg: number | null;
  time_utc?: string;
  sun?: { az_offset_deg: number; elev_deg?: number };
  samples: Sample[];
};

/** How the skyline API set the camera up: for the app, not sent to the engine. */
export type Diagnostics = {
  /** False when even the top of the photo looks below the horizon: no skyline can be in it. */
  sky_visible?: boolean;
  camera_model: 'pinhole' | 'cahvore';
  camera_source: string;
  level_source: 'label' | 'sensor' | 'manual' | 'assumed';
  pitch_deg: number;
  roll_deg: number;
  az_step_deg: number;
  /** Perseverance: the camera's direction from the rover's forward direction (not the answer). */
  rover_axis_azimuth_deg: number | null;
  /** Perseverance: the rover pose (site/drive) the photo was taken at. */
  rover_pose: string | null;
};

/** Why a stretch of the line is not trusted. 'erased' and 'rock' are the user's own marks. */
export type Reason = 'near' | 'haze' | 'jitter' | 'edge' | 'top' | 'glare' | 'erased' | 'rock';

/** The traced line in the photo's own pixels, one point per column, left to right. */
export type Trace = {
  width: number; height: number;
  x: number[]; y: number[]; weight: number[]; reason: (Reason | null)[];
  sun_px: [number, number] | null;
};

export type SkylineResponse = {
  contract_version: string; photo: ContractPhoto; diagnostics: Diagnostics; trace: Trace; debug_image: string;
};
export type ConvertResponse = { contract_version: string; photo: ContractPhoto; diagnostics: Diagnostics };

/** What the user tells us about the camera; sent to the skyline API as the `camera` JSON. */
export type CameraSpec = {
  preset?: string;
  hfov_deg?: number;
  pitch_deg?: number;
  roll_deg?: number;
  level_source?: 'sensor' | 'manual';
  eye_height_m?: number;
  time_utc?: string;
};

// ------------------------------------------------------------------ POST /locate (section 2)

export type LocateRequest = {
  contract_version: string;
  photos: (ContractPhoto & { id: string })[];
  options?: {
    prior?: { lat: number; lon: number; radius_m: number };
    top_k?: number;
    include_likelihood_grid?: boolean;
    include_residuals?: boolean;
  };
};

// ------------------------------------------------------------------ its result (section 3)

export type LatLonEN = { lat: number; lon: number; east_m: number; north_m: number };

/**
 * The engine writes `null` for any number it could not compute (NaN or infinite). Fields the app can
 * do without are typed `number | null` and shown as "—"; the ones it can't draw an answer without
 * (the position and both uncertainty radii) are required, and a result missing them is rejected.
 */
type Num = number | null;

export type Candidate = LatLonEN & { rank: number; heading_deg: Num; score: Num; probability: Num };

export type DominantFeature = {
  name: string | null;
  lat: Num; lon: Num; east_m: Num; north_m: Num;
  elevation_m: Num; distance_m: Num; distance_check_m: Num;
  azimuth_deg: Num; elev_angle_deg: Num; prominence_deg: Num; photo_id: string; az_offset_deg: Num;
};

export type PhotoFit = {
  id: string; heading_deg: Num; horizon_shift_deg: Num; horizon_tilt_deg?: Num; rms_residual_deg: Num;
  median_abs_residual_deg: Num; inlier_fraction: Num;
  residuals?: { az_offset_deg: Num; observed_elev_deg: Num; model_elev_deg: Num; residual_deg: Num; distance_m: Num; used: boolean }[];
};

export type LocateResult = {
  contract_version: string;
  status: 'ok' | 'ambiguous' | 'no_match';
  warnings: string[];
  best: LatLonEN & {
    ground_elevation_m: Num; heading_deg: Num; score: Num; probability: Num;
    /** Required: a result without them is rejected (the app never draws a fix with no stated uncertainty). */
    uncertainty_m: number; uncertainty_95_m: number;
  };
  candidates: Candidate[];
  likelihood_grid: null | {
    bounds: [[number, number], [number, number]];
    rows: number; cols: number;
    cell_size_m: { north_south: number; east_west: number };
    scale: number;
    values: number[][];
  };
  dominant_feature: null | DominantFeature;
  photos: PhotoFit[];
  engine: { version: string; contract_version?: string; terrain_sources: string[]; candidate_spacing_m: number; timing_ms: Record<string, number> };
};

// ------------------------------------------------------------------ checks

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numArray = (v: unknown, n?: number) => Array.isArray(v) && v.every(isNum) && (n === undefined || v.length === n);
const isSample = (s: unknown) => isObj(s) && isNum(s.az_offset_deg) && isNum(s.elev_deg) && isNum(s.weight);

export function isContractPhoto(v: unknown): v is ContractPhoto {
  if (!isObj(v) || !isObj(v.camera) || !Array.isArray(v.samples)) return false;
  const c = v.camera;
  return [c.hfov_deg, c.vfov_deg, c.width_px, c.height_px].every(isNum) && typeof c.lens_model === 'string'
    && isNum(v.eye_height_m) && isNum(v.horizon_uncertainty_deg)
    && (v.relative_heading_deg === null || isNum(v.relative_heading_deg))
    && (v.time_utc === undefined || typeof v.time_utc === 'string')
    && (v.sun === undefined || (isObj(v.sun) && isNum(v.sun.az_offset_deg)))
    && v.samples.every(isSample);
}

export function isDiagnostics(v: unknown): v is Diagnostics {
  return isObj(v) && (v.camera_model === 'pinhole' || v.camera_model === 'cahvore')
    && typeof v.level_source === 'string' && isNum(v.pitch_deg) && isNum(v.roll_deg)
    && (v.rover_axis_azimuth_deg === null || isNum(v.rover_axis_azimuth_deg))
    && (v.rover_pose === null || typeof v.rover_pose === 'string');
}

export function isTrace(v: unknown): v is Trace {
  if (!isObj(v) || !isNum(v.width) || !isNum(v.height) || !Array.isArray(v.x)) return false;
  const n = v.x.length;
  return n >= 2 && numArray(v.x) && numArray(v.y, n) && numArray(v.weight, n)
    && Array.isArray(v.reason) && v.reason.length === n
    && v.reason.every(r => r === null || typeof r === 'string')
    && (v.sun_px === null || numArray(v.sun_px, 2));
}

export function isConvertResponse(v: unknown): v is ConvertResponse {
  return isObj(v) && typeof v.contract_version === 'string' && isContractPhoto(v.photo) && isDiagnostics(v.diagnostics);
}

export function isSkylineResponse(v: unknown): v is SkylineResponse {
  return isConvertResponse(v) && isTrace((v as Record<string, unknown>).trace)
    && typeof (v as Record<string, unknown>).debug_image === 'string'
    && ((v as Record<string, unknown>).debug_image as string).startsWith('data:image/');
}

const isLatLonEN = (v: unknown): v is LatLonEN => isObj(v) && [v.lat, v.lon, v.east_m, v.north_m].every(isNum);
/** A number, or the engine's `null` for one it could not compute. */
const isNumOrNull = (v: unknown) => v === null || isNum(v);
const allNumOrNull = (o: Record<string, unknown>, keys: string[]) => keys.every(k => isNumOrNull(o[k]));

export function isLocateResult(v: unknown): v is LocateResult {
  if (!isObj(v) || !isObj(v.best) || !Array.isArray(v.candidates) || !Array.isArray(v.photos)) return false;
  const b = v.best;
  // Position and both radii are required; everything else may be null (shown as "—").
  const bestOk = isNum(b.uncertainty_m) && isNum(b.uncertainty_95_m)
    && allNumOrNull(b, ['heading_deg', 'score', 'probability'])
    && (b.ground_elevation_m === undefined || isNumOrNull(b.ground_elevation_m)) && isLatLonEN(b);
  const grid = v.likelihood_grid;
  const gridOk = grid === null || grid === undefined || (isObj(grid) && Array.isArray(grid.bounds) && isNum(grid.rows)
    && isNum(grid.cols) && isNum(grid.scale) && Array.isArray(grid.values) && grid.values.length === grid.rows
    && grid.values.every(r => numArray(r, grid.cols as number)));
  const f = v.dominant_feature;
  const featureOk = f === null || f === undefined || (isObj(f) && (f.name === null || typeof f.name === 'string')
    && allNumOrNull(f, ['lat', 'lon', 'east_m', 'north_m', 'elevation_m', 'distance_m', 'distance_check_m',
      'azimuth_deg', 'elev_angle_deg', 'prominence_deg', 'az_offset_deg']));
  return (v.status === 'ok' || v.status === 'ambiguous' || v.status === 'no_match')
    && Array.isArray(v.warnings) && v.warnings.every(w => typeof w === 'string')
    && bestOk && isObj(v.engine)
    && v.candidates.every(c => isLatLonEN(c) && allNumOrNull(c, ['heading_deg', 'score', 'probability']))
    && v.photos.every(p => isObj(p) && typeof p.id === 'string'
      && allNumOrNull(p, ['heading_deg', 'horizon_shift_deg', 'rms_residual_deg', 'median_abs_residual_deg', 'inlier_fraction'])
      && (p.horizon_tilt_deg === undefined || isNumOrNull(p.horizon_tilt_deg)))
    && gridOk && featureOk;
}
