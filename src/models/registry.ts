import { z } from 'zod';
import registryJson from '../../src-tauri/models.json';

const GIB = 1024 ** 3;
const LOW_RAM_TOLERANCE = 0.9;

const fileSchema = z.strictObject({
  name: z.string().min(1),
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.number().int().positive(),
});

const modelSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/u),
  displayName: z.string().min(1),
  license: z.string().min(1),
  recommendedRamGb: z.number().int().positive(),
  files: z.strictObject({ model: fileSchema, mmproj: fileSchema }),
  server: z.strictObject({
    contextSize: z.number().int().positive(),
    imageMaxTokens: z.number().int().positive().nullable(),
    threads: z.number().int().positive().nullable(),
    gpuLayers: z.number().int().nonnegative().nullable(),
  }),
  request: z.strictObject({
    maxOutputTokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2),
    imageMaxEdge: z.number().int().min(64),
  }),
  prompt: z.string().min(1),
});

const registrySchema = z.strictObject({ models: z.array(modelSchema).min(1) });

export type ModelInfo = z.infer<typeof modelSchema>;

export const MODELS: readonly ModelInfo[] = registrySchema.parse(registryJson).models;

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((model) => model.id === id);
}

export function totalBytes(model: ModelInfo): number {
  return model.files.model.bytes + model.files.mmproj.bytes;
}

export function recommendedRamBytes(model: ModelInfo): number {
  return model.recommendedRamGb * GIB;
}

export function isLowOnMemory(model: ModelInfo, totalRamBytes: number): boolean {
  return totalRamBytes < recommendedRamBytes(model) * LOW_RAM_TOLERANCE;
}

export const DEFAULT_MODEL_ID = 'glm-ocr-q8';

export function recommendModel(models: readonly ModelInfo[] = MODELS): ModelInfo {
  const chosen =
    models.find((model) => model.id === DEFAULT_MODEL_ID) ??
    models.reduce<ModelInfo | undefined>(
      (smallest, model) =>
        smallest === undefined || model.recommendedRamGb < smallest.recommendedRamGb
          ? model
          : smallest,
      undefined,
    );
  if (chosen === undefined) throw new Error('Die Modellliste ist leer.');
  return chosen;
}

export function offeredModels(
  totalRamBytes: number | null,
  models: readonly ModelInfo[] = MODELS,
): readonly ModelInfo[] {
  const fallback = recommendModel(models);
  return models.filter(
    (model) =>
      model.id === fallback.id || (totalRamBytes !== null && !isLowOnMemory(model, totalRamBytes)),
  );
}

export interface ModelNote {
  readonly speed: string;
  readonly accuracy: string;
}

const MODEL_NOTES: Readonly<Record<string, ModelNote>> = {
  'qwen3-vl-4b-q4': {
    speed: 'Etwa doppelt so langsam wie GLM-OCR.',
    accuracy:
      'Zählt die Wörter genauer, im Test weichen sie im Mittel um 0,9 statt 1,6 % ab. Nur zum Wörterzählen geeignet, weil es beim Abschreiben gelegentlich Fehler der Schüler verbessert.',
  },
};

export function modelNote(model: ModelInfo): ModelNote | null {
  return MODEL_NOTES[model.id] ?? null;
}

export interface ModelSource {
  readonly host: string;
  readonly repository: string;
}

export function modelSource(model: ModelInfo): ModelSource {
  const url = new URL(model.files.model.url);
  const [owner, name] = url.pathname.split('/').filter(Boolean);
  return { host: url.hostname, repository: owner && name ? `${owner}/${name}` : url.hostname };
}
