import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import jpeg from 'jpeg-js';
import { applyDewarp, planDewarp } from '../src/layout/dewarp.ts';
import { readJpeg } from '../src/layout/image-files.ts';

const QUALITY = 90;

function main() {
  const [source, target] = process.argv.slice(2);
  if (source === undefined || target === undefined) {
    throw new Error('Aufruf: dewarp-pages.ts <Ordner mit Bildern> <Zielordner>');
  }
  mkdirSync(target, { recursive: true });
  const files = readdirSync(source)
    .filter((file) => file.endsWith('.jpg'))
    .toSorted();
  let straightened = 0;
  for (const file of files) {
    const image = readJpeg(join(source, file));
    const plan = planDewarp(image);
    if (plan === null) {
      copyFileSync(join(source, file), join(target, file));
      continue;
    }
    straightened += 1;
    writeFileSync(join(target, file), jpeg.encode(applyDewarp(image, plan), QUALITY).data);
    console.log(`${file} begradigt`);
  }
  console.log(`${straightened} von ${files.length} Seiten begradigt`);
}

main();
