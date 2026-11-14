// Camera choices offered in the Locate screen. The ids are backend/skyline/metadata.py PRESETS keys;
// the skyline API computes the field of view from them.

export type CameraChoice =
  | { kind: 'auto' } // from the photo's EXIF focal length
  | { kind: 'preset'; id: string }
  | { kind: 'fov'; hfovDeg: number } // typed in by the user
  | { kind: 'label' }; // a Perseverance label file supplies the camera

export const PRESETS: { id: string; label: string; group: 'Phone' | 'Perseverance' }[] = [
  { id: 'iphone-main', label: 'iPhone main camera (13–16)', group: 'Phone' },
  { id: 'iphone-ultrawide', label: 'iPhone ultra-wide', group: 'Phone' },
  { id: 'pixel-main', label: 'Google Pixel main camera (7–9)', group: 'Phone' },
  { id: 'galaxy-main', label: 'Samsung Galaxy S main camera (22–24)', group: 'Phone' },
  { id: 'generic-phone', label: 'Other phone, main camera', group: 'Phone' },
  { id: 'm2020-navcam', label: 'Navcam (no label: nominal 96°)', group: 'Perseverance' },
  { id: 'm2020-mastcamz-26mm', label: 'Mastcam-Z at 26 mm', group: 'Perseverance' },
  { id: 'm2020-mastcamz-110mm', label: 'Mastcam-Z at 110 mm', group: 'Perseverance' },
];

/** Horizontal field of view (landscape) of a phone preset, for the level guide: 35 mm equivalents. */
const PHONE_35MM: Record<string, number> = {
  'iphone-main': 26, 'iphone-ultrawide': 13, 'pixel-main': 25, 'galaxy-main': 23, 'generic-phone': 26,
};
const FIXED_HFOV: Record<string, [number, number]> = {
  'm2020-navcam': [96, 73], 'm2020-mastcamz-26mm': [25.6, 19.2], 'm2020-mastcamz-110mm': [6.2, 4.6],
};

/** The field of view the API will use for this choice and photo size, or null if it depends on EXIF. */
export function hfovFor(choice: CameraChoice, width: number, height: number): number | null {
  if (choice.kind === 'fov') return choice.hfovDeg;
  if (choice.kind !== 'preset') return null;
  const f35 = PHONE_35MM[choice.id];
  if (f35) {
    const widthMm = (43.27 * width) / Math.hypot(width, height);
    return (2 * Math.atan(widthMm / (2 * f35)) * 180) / Math.PI;
  }
  const fixed = FIXED_HFOV[choice.id];
  if (!fixed) return null;
  return width >= height ? fixed[0] : fixed[1];
}
