// Copies the map data from ../data (read-only, owned by the data team) into public/data,
// the only place Next.js serves static files from. Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = resolve(frontend, '..', 'data');
const target = join(frontend, 'public', 'data');

const files = [
  'map_layers.json',
  'output/slope.png',
  'output/slope_bounds.json',
  'output/sand.geojson',
];

mkdirSync(target, { recursive: true });
for (const file of files) {
  copyFileSync(join(data, file), join(target, basename(file)));
}
console.log(`copy-data: ${files.length} files -> public/data/`);
