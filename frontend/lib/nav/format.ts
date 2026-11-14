export function formatDistance(m: number): { value: string; unit: 'm' | 'km' } {
  if (m < 1000) return { value: String(Math.round(m)), unit: 'm' };
  return { value: (m / 1000).toFixed(2), unit: 'km' };
}

/** 'MM:SS' below one hour, 'H:MM:SS' above; rounds down to whole seconds. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}`;
}

/** Longitude as 0-360° east. */
export function formatLon(lon: number): string {
  return `${(((lon % 360) + 360) % 360).toFixed(4)}° E`;
}
