// Copies the map data from ../data (read-only, owned by the data team) into public/data,
// the only place Next.js serves static files from. Runs before `dev` and `build`.
// Copies map_layers.json and everything in data/output/, so new outputs show up without
// changing this script; public/data is emptied first so removed outputs don't linger.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = resolve(frontend, '..', 'data');
const output = join(data, 'output');
const target = join(frontend, 'public', 'data');

const files = [
  join(data, 'map_layers.json'),
  ...readdirSync(output, { withFileTypes: true }).filter(e => e.isFile()).map(e => join(output, e.name)),
];

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(file, join(target, basename(file)));
console.log(`copy-data: ${files.length} files -> public/data/`);
