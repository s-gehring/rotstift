import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyModelInfo, CorrectorInfo, ModelInfo } from '../src/models/registry.ts';
import { evalDir, modelsDir } from './paths.ts';

function entries(): AnyModelInfo[] {
  const json: { models: AnyModelInfo[] } = JSON.parse(
    readFileSync(join(evalDir, '..', 'src-tauri', 'models.json'), 'utf8'),
  );
  return json.models;
}

export function transcriber(id: string): ModelInfo {
  const found = entries().find((model) => model.id === id);
  if (found?.role !== 'transcriber') throw new Error(`Kein Erkennungsmodell ${id}`);
  return found;
}

export function corrector(id: string): CorrectorInfo {
  const found = entries().find((model) => model.id === id);
  if (found?.role !== 'corrector') throw new Error(`Kein Korrekturmodell ${id}`);
  return found;
}

export function localFile(url: string): string {
  return join(modelsDir(), decodeURIComponent(url.split('/').at(-1) ?? ''));
}
