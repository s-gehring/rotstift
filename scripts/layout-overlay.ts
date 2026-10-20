import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { detectLineBoxes } from '../src/layout/locate-lines.ts';
import { drawBoxes, encodePng, readJpeg } from '../src/layout/image-files.ts';

const dataset =
  process.env['ROTSTIFT_DATASET'] ??
  join(homedir(), '.cache', 'rotstift', 'datasets', 'scads-fullpage', 'extracted');
const [outDir, ...pages] = process.argv.slice(2);
if (outDir === undefined) {
  console.error('usage: node scripts/layout-overlay.ts <out-dir> [page ...]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const images = readdirSync(join(dataset, 'images')).filter((name) => name.endsWith('.jpg'));
const selected =
  pages.length > 0 ? images.filter((name) => pages.includes(name.slice(0, -4))) : images;

for (const name of selected) {
  const image = readJpeg(join(dataset, 'images', name));
  const started = performance.now();
  const result = detectLineBoxes(image);
  const elapsed = performance.now() - started;
  writeFileSync(
    join(outDir, name.replace('.jpg', '.png')),
    encodePng(drawBoxes(image, result.boxes)),
  );
  console.log(
    `${name} ${image.width}x${image.height} lines=${result.boxes.length} skew=${result.skewDegrees.toFixed(2)} ${elapsed.toFixed(0)}ms`,
  );
}
