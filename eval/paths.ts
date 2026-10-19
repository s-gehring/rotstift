import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

export const evalDir = import.meta.dirname;
export const samplesDir = join(evalDir, 'samples');
export const binariesDir = join(evalDir, '..', 'src-tauri', 'binaries');

export function modelsDir(): string {
  return process.env['ROTSTIFT_MODELS_DIR'] ?? join(homedir(), '.cache', 'rotstift', 'models');
}

export function llamaServer(): { binary: string; libraryDir: string } {
  const stamp: unknown = JSON.parse(readFileSync(join(binariesDir, 'runtime.json'), 'utf8'));
  const target =
    typeof stamp === 'object' && stamp !== null && 'target' in stamp ? String(stamp.target) : '';
  const suffix = target.includes('windows') ? '.exe' : '';
  return {
    binary: join(binariesDir, `llama-server-${target}${suffix}`),
    libraryDir: join(binariesDir, 'llama'),
  };
}
