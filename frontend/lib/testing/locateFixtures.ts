// Test fixtures for lib/locate: the shapes of backend/CONTRACTS.md (0.1). For tests only; the app
// never shows any of this.

import type { ContractPhoto, Diagnostics, LocateResult, SkylineResponse, Trace } from '@/lib/locate/types';

export const trace: Trace = {
  width: 4, height: 3, x: [0, 1, 2, 3], y: [1, 1, 1, 1], weight: [1, 1, 1, 1], reason: [null, null, null, null], sun_px: null,
};

/** A photo entry with `n` samples of the given weight (the contract asks for at least 20). */
export function contractPhoto(weight = 1, n = 30): ContractPhoto {
  return {
    camera: { hfov_deg: 60, vfov_deg: 46.8, width_px: 4, height_px: 3, lens_model: 'rectilinear' },
    eye_height_m: 1.7,
    horizon_uncertainty_deg: 5,
    relative_heading_deg: null,
    samples: Array.from({ length: n }, (_, k) => ({ az_offset_deg: -15 + k, elev_deg: 1, weight })),
  };
}

export function diagnostics(over: Partial<Diagnostics> = {}): Diagnostics {
  return {
    camera_model: 'pinhole', camera_source: 'preset', level_source: 'assumed', pitch_deg: 0, roll_deg: 0,
    az_step_deg: 0.1, rover_axis_azimuth_deg: null, rover_pose: null, ...over,
  };
}

export function skylineResponse(weight = 1, diag: Partial<Diagnostics> = {}): SkylineResponse {
  return {
    contract_version: '0.1', photo: contractPhoto(weight), diagnostics: diagnostics(diag), trace,
    debug_image: 'data:image/jpeg;base64,AAAA',
  };
}

/** The example result of CONTRACTS.md section 3, trimmed: a shape check, not an engine answer. */
export const contractResult: LocateResult = {
  contract_version: '0.1',
  status: 'ok',
  warnings: [],
  best: {
    lat: 18.4452, lon: 77.4391, east_m: -657.8, north_m: 29.6, ground_elevation_m: -2561.3, heading_deg: 262.5,
    score: 0.91, probability: 0.84, uncertainty_m: 140, uncertainty_95_m: 420,
  },
  candidates: [
    { rank: 1, lat: 18.4452, lon: 77.4391, east_m: -657.8, north_m: 29.6, heading_deg: 262.5, score: 0.91, probability: 0.84 },
    { rank: 2, lat: 18.4710, lon: 77.4466, east_m: -236.1, north_m: 1558.9, heading_deg: 255.0, score: 0.74, probability: 0.11 },
  ],
  likelihood_grid: {
    bounds: [[18.35, 77.35], [18.54, 77.55]], rows: 2, cols: 4,
    cell_size_m: { north_south: 200, east_west: 200.2 }, scale: 255, values: [[0, 0, 3, 12], [0, 1, 40, 255]],
  },
  dominant_feature: {
    name: null, lat: 18.4581, lon: 77.2702, east_m: -10157.0, north_m: 820.5, elevation_m: -1978.0, distance_m: 9530,
    distance_check_m: 9410, azimuth_deg: 274.6, elev_angle_deg: 3.46, prominence_deg: 1.1, photo_id: 'photo_1', az_offset_deg: 12.1,
  },
  photos: [{ id: 'photo_1', heading_deg: 262.5, horizon_shift_deg: 0.04, rms_residual_deg: 0.09, median_abs_residual_deg: 0.05, inlier_fraction: 0.91 }],
  engine: { version: '0.1.0', terrain_sources: ['ctx_20m'], candidate_spacing_m: 200, timing_ms: { total: 1840 } },
};
