// Real Mars time at Jezero, from the NASA GISS Mars24 algorithm (Allison & McEwen 2000).
// https://www.giss.nasa.gov/tools/mars24/help/algorithm.html
//
// Local Mean Solar Time (LMST) is what the Perseverance team keeps its sols in. Sol numbers count from the
// landing sol, which is sol 0.

const MS_PER_DAY = 86_400_000;
const TT_MINUS_UTC_S = 69.184; // 37 leap seconds + 32.184 s, unchanged since 2017
const SOL_RATIO = 1.0274912517; // Earth days per sol

/** Jezero, the Perseverance landing site (east longitude, degrees). */
export const JEZERO_LON_EAST = 77.4508;
/** Perseverance touchdown, 2021-02-18 20:43:49 UTC (spacecraft event time). */
export const PERSEVERANCE_LANDING_UTC_MS = Date.UTC(2021, 1, 18, 20, 43, 49);

/** Mars Sol Date: days since the Mars epoch, on the prime meridian (Mars24 step C-2). */
export function marsSolDate(utcMs: number): number {
  const jdTT = utcMs / MS_PER_DAY + 2440587.5 + TT_MINUS_UTC_S / 86_400;
  return (jdTT - 2451545.0 - 4.5) / SOL_RATIO + 44796.0 - 0.0009626;
}

/** Local mean solar time at an east longitude, in milliseconds of the sol (0 .. 86 400 000). */
export function lmstMs(utcMs: number, lonEastDeg: number = JEZERO_LON_EAST): number {
  const localMsd = marsSolDate(utcMs) + lonEastDeg / 360;
  return (localMsd - Math.floor(localMsd)) * MS_PER_DAY;
}

/** Perseverance mission sol (landing sol = 0) at Jezero for a UTC instant. */
export function perseveranceSol(utcMs: number): number {
  const local = (t: number) => Math.floor(marsSolDate(t) + JEZERO_LON_EAST / 360);
  return local(utcMs) - local(PERSEVERANCE_LANDING_UTC_MS);
}

/** 'HH:MM:SS' for milliseconds into a day (or sol), wrapping. */
export function hhmmss(ms: number): string {
  const total = Math.floor((((ms % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
