import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { CANDIDATES, fileUrl } from './models.ts';
import type { Candidate, ModelFile } from './models.ts';
import { modelsDir } from './paths.ts';

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function download(candidate: Candidate, file: ModelFile, dir: string, verify: boolean) {
  const target = join(dir, file.name);
  if (existsSync(target) && statSync(target).size === file.bytes) {
    if (!verify || (await sha256(target)) === file.sha256) return;
    throw new Error(`SHA256 mismatch for existing ${target}, delete it and retry`);
  }

  const url = fileUrl(candidate, file);
  console.log(`Downloading ${url} (${(file.bytes / 1e9).toFixed(2)} GB)`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  const partial = `${target}.part`;
  const hash = createHash('sha256');
  const output = createWriteStream(partial);
  await pipeline(
    response.body,
    async function* (source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    output,
  );
  const actual = hash.digest('hex');
  if (actual !== file.sha256) {
    await rm(partial);
    throw new Error(`SHA256 mismatch for ${url}: expected ${file.sha256}, got ${actual}`);
  }
  await rename(partial, target);
}

async function main() {
  const { values } = parseArgs({
    options: { models: { type: 'string' }, verify: { type: 'boolean', default: false } },
  });
  const wanted = values.models?.split(',');
  const dir = modelsDir();
  await mkdir(dir, { recursive: true });
  for (const candidate of CANDIDATES) {
    if (wanted && !wanted.includes(candidate.id)) continue;
    for (const file of [candidate.model, candidate.mmproj]) {
      await download(candidate, file, dir, values.verify);
    }
    console.log(`${candidate.id}: ok`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
