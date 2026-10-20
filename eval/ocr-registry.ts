import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyModelInfo, CorrectorInfo, ModelInfo } from '../src/models/registry.ts';
import { evalDir, modelsDir } from './paths.ts';

function readModels(file: string): AnyModelInfo[] {
  const json: { models: AnyModelInfo[] } = JSON.parse(readFileSync(file, 'utf8'));
  return json.models;
}

export function candidateTranscribers(): ModelInfo[] {
  return readModels(join(evalDir, 'ocr-candidates.json')).filter(
    (model): model is ModelInfo => model.role === 'transcriber',
  );
}

function entries(): AnyModelInfo[] {
  return [
    ...readModels(join(evalDir, '..', 'src-tauri', 'models.json')),
    ...candidateTranscribers(),
  ];
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

export function localFile(file: { name: string }): string {
  return join(modelsDir(), file.name);
}
