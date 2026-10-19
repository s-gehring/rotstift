import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { readTarGz, readZip } from './runtime/archive.ts';
import { LICENSE, LLAMA_CPP_VERSION, assetUrl, findAsset, hostTarget } from './runtime/manifest.ts';
import { selectRuntimeFiles } from './runtime/select-files.ts';

const binariesDir = join(import.meta.dirname, '..', 'src-tauri', 'binaries');
const libraryDir = join(binariesDir, 'llama');
const downloadDir = join(binariesDir, '.download');
const stampFile = join(binariesDir, 'runtime.json');

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

async function download(url: string, expectedSha256: string, cacheName: string) {
  const cached = join(downloadDir, cacheName);
  if (existsSync(cached)) {
    const data = new Uint8Array(await readFile(cached));
    if (sha256(data) === expectedSha256) return data;
    await rm(cached);
  }
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== expectedSha256) {
    throw new Error(`SHA256 mismatch for ${url}: expected ${expectedSha256}, got ${actual}`);
  }
  await mkdir(downloadDir, { recursive: true });
  await writeFile(cached, data);
  return data;
}

async function main() {
  const { values } = parseArgs({ options: { target: { type: 'string' } } });
  const target = values.target ?? hostTarget(process.platform, process.arch);
  if (!target) throw new Error(`Unsupported host ${process.platform}-${process.arch}`);
  const asset = findAsset(target);
  const exeSuffix = target.includes('windows') ? '.exe' : '';
  const serverPath = join(binariesDir, `llama-server-${target}${exeSuffix}`);
  const stamp = JSON.stringify({ version: LLAMA_CPP_VERSION, target });

  if (existsSync(serverPath) && existsSync(stampFile)) {
    if ((await readFile(stampFile, 'utf8')) === stamp) {
      console.log(`llama.cpp ${LLAMA_CPP_VERSION} for ${target} is already in place`);
      return;
    }
  }

  const archive = await download(assetUrl(asset), asset.sha256, asset.archive);
  const license = await download(LICENSE.url, LICENSE.sha256, `LICENSE-${LLAMA_CPP_VERSION}`);
  const entries = asset.archive.endsWith('.zip') ? readZip(archive) : readTarGz(archive);
  const files = selectRuntimeFiles(entries, exeSuffix);

  await rm(libraryDir, { recursive: true, force: true });
  await mkdir(libraryDir, { recursive: true });
  for (const [name, data] of files.libraries) {
    await writeFile(join(libraryDir, name), data, { mode: 0o755 });
  }
  for (const [name, data] of files.notices) {
    await writeFile(join(libraryDir, name), data);
  }
  await writeFile(join(libraryDir, 'LICENSE-llama.cpp'), license);
  await writeFile(serverPath, files.server);
  await chmod(serverPath, 0o755);
  await writeFile(stampFile, stamp);

  console.log(
    `llama.cpp ${LLAMA_CPP_VERSION} for ${target}: llama-server and ${files.libraries.size} libraries`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
