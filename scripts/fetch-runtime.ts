import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const SIDECAR_NAME = 'rotstift-llama-server';
const MSVC_RUNTIME = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

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

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function msvcRuntimeDir(): string {
  if (process.platform !== 'win32') {
    throw new Error('The Windows runtime needs the MSVC redistributable, fetch it on Windows');
  }
  const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const installations = execFileSync(
    vswhere,
    ['-all', '-products', '*', '-property', 'installationPath'],
    { encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .filter(Boolean);
  for (const installation of installations) {
    const redist = join(installation, 'VC', 'Redist', 'MSVC');
    if (!existsSync(redist)) continue;
    const versions = readdirSync(redist)
      .filter((name) => /^\d+(\.\d+)+$/.test(name))
      .toSorted(compareVersions)
      .toReversed();
    for (const version of versions) {
      const architecture = join(redist, version, 'x64');
      if (!existsSync(architecture)) continue;
      const crts = readdirSync(architecture).filter((name) => /^Microsoft\.VC\d+\.CRT$/.test(name));
      for (const crt of crts) {
        const dir = join(architecture, crt);
        if (MSVC_RUNTIME.every((name) => existsSync(join(dir, name)))) return dir;
      }
    }
  }
  throw new Error(`No Visual Studio installation provides ${MSVC_RUNTIME.join(', ')}`);
}

function sameStamp(text: string, expected: { version: string; target: string }): boolean {
  try {
    const stamp: unknown = JSON.parse(text);
    return (
      typeof stamp === 'object' &&
      stamp !== null &&
      'version' in stamp &&
      'target' in stamp &&
      stamp.version === expected.version &&
      stamp.target === expected.target
    );
  } catch {
    return false;
  }
}

async function main() {
  const { values } = parseArgs({ options: { target: { type: 'string' } } });
  const target = values.target ?? hostTarget(process.platform, process.arch);
  if (!target) throw new Error(`Unsupported host ${process.platform}-${process.arch}`);
  const asset = findAsset(target);
  const exeSuffix = target.includes('windows') ? '.exe' : '';
  const serverPath = join(binariesDir, `${SIDECAR_NAME}-${target}${exeSuffix}`);
  const stamp = { version: LLAMA_CPP_VERSION, target };

  if (existsSync(serverPath) && existsSync(stampFile)) {
    if (sameStamp(await readFile(stampFile, 'utf8'), stamp)) {
      console.log(`llama.cpp ${LLAMA_CPP_VERSION} for ${target} is already in place`);
      return;
    }
  }
  await rm(stampFile, { force: true });

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
  if (target.includes('windows')) {
    const runtimeDir = msvcRuntimeDir();
    for (const name of MSVC_RUNTIME) await copyFile(join(runtimeDir, name), join(libraryDir, name));
  }
  await writeFile(serverPath, files.server);
  await chmod(serverPath, 0o755);
  await writeFile(stampFile, JSON.stringify(stamp));

  console.log(
    `llama.cpp ${LLAMA_CPP_VERSION} for ${target}: ${SIDECAR_NAME} and ${files.libraries.size} libraries`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
