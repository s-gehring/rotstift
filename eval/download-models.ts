import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { CORRECTORS } from './correct-models.ts';
import { candidateCorrectors, draftFiles } from './model-candidates.ts';
import { CANDIDATES, fileUrl } from './models.ts';
import type { ModelFile } from './models.ts';
import { candidateTranscribers } from './ocr-registry.ts';
import { modelsDir } from './paths.ts';

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function download(url: string, file: ModelFile, dir: string, verify: boolean) {
  const target = join(dir, file.name);
  if (existsSync(target) && statSync(target).size === file.bytes) {
    if (!verify || (await sha256(target)) === file.sha256) return;
    throw new Error(`SHA256 mismatch for existing ${target}, delete it and retry`);
  }

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
  const jobs = [
    ...CANDIDATES.map((candidate) => ({
      id: candidate.id,
      files: [candidate.model, candidate.mmproj].map((file) => ({
        file,
        url: fileUrl(candidate, file),
      })),
    })),
    ...CORRECTORS.map((corrector) => ({
      id: corrector.id,
      files: [{ file: corrector.model, url: fileUrl(corrector, corrector.model) }],
    })),
    ...candidateTranscribers().map((model) => ({
      id: model.id,
      files: [model.files.model, model.files.mmproj].map((file) => ({ file, url: file.url })),
    })),
    ...candidateCorrectors().map((model) => ({
      id: model.id,
      files: [{ file: model.files.model, url: model.files.model.url }],
    })),
    ...draftFiles().map((draft) => ({
      id: draft.id,
      files: [{ file: draft.file, url: draft.file.url }],
    })),
  ];
  for (const job of jobs) {
    if (wanted && !wanted.includes(job.id)) continue;
    for (const { file, url } of job.files) {
      await download(url, file, dir, values.verify);
    }
    console.log(`${job.id}: ok`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
