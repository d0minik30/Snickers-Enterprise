// How sure the traveller is of their position. There is no GPS on Mars: the traveller dead-reckons between
// fixes, and gets a fix by sending photos of the skyline to the localization engine (backend/marsloc, the
// /locate screen). These numbers are model assumptions, kept in one place so the team can tune them.

/** Error at the start, standing on the surveyed base. */
export const BASE_ERROR_M = 1;
/**
 * Error right after a photo fix, from a real engine run: three Navcam photos (sol 20, pose 3/770) through the
 * Locate screen came back 18 m from the truth with a 68 % circle of ±47 m (95 %: ±76 m).
 */
export const PHOTO_FIX_ERROR_M = 47;
/** Dead-reckoning drift: metres of error gained per metre walked since the last fix. */
export const DRIFT_PER_M = 0.02;

/** Position uncertainty in metres, `distSinceFixM` after a fix whose own error was `fixErrorM`. */
export function positionErrorM(distSinceFixM: number, fixErrorM: number = BASE_ERROR_M): number {
  return fixErrorM + DRIFT_PER_M * distSinceFixM;
}
