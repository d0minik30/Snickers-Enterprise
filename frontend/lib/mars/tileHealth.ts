export type TileHealth = {
  loaded(): void;
  failed(): void;
  readonly unavailable: boolean;
  reset(): void;
};

const MIN_FAILURES = 3;

/** Counts tile loads and failures; imagery counts as unavailable once failures clearly dominate. */
export function createTileHealth(): TileHealth {
  let loads = 0;
  let failures = 0;
  return {
    loaded() { loads++; },
    failed() { failures++; },
    get unavailable() { return failures >= MIN_FAILURES && failures > loads; },
    reset() { loads = 0; failures = 0; },
  };
}
