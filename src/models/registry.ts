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

const commonFields = {
  id: z.string().regex(/^[a-z0-9-]+$/u),
  displayName: z.string().min(1),
  license: z.string().min(1),
  recommendedRamGb: z.number().int().positive(),
};

const serverFields = {
  contextSize: z.number().int().positive(),
  threads: z.number().int().positive().nullable(),
  gpuLayers: z.number().int().nonnegative().nullable(),
  cpuRepack: z.boolean(),
  reasoning: z.enum(['auto', 'off']),
};

const requestFields = {
  maxOutputTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
};

const transcriberSchema = z.strictObject({
  ...commonFields,
  role: z.literal('transcriber'),
  files: z.strictObject({ model: fileSchema, mmproj: fileSchema }),
  server: z.strictObject({
    ...serverFields,
    imageMaxTokens: z.number().int().positive().nullable(),
  }),
  request: z.strictObject({
    ...requestFields,
    imageMaxEdge: z.number().int().min(64),
    uncertainBelow: z.number().gt(0).lt(1).nullable(),
  }),
  prompt: z.string().min(1),
});

const correctorSchema = z.strictObject({
  ...commonFields,
  role: z.literal('corrector'),
  files: z.strictObject({ model: fileSchema }),
  server: z.strictObject(serverFields),
  request: z.strictObject(requestFields),
  lineMode: z.enum(['plain', 'numbered']),
  system: z.string().trim().min(1).optional(),
  prompt: z.string().includes('{text}'),
});

const registrySchema = z.strictObject({
  models: z.array(z.discriminatedUnion('role', [transcriberSchema, correctorSchema])).min(1),
});

export type ModelInfo = z.infer<typeof transcriberSchema>;
export type CorrectorInfo = z.infer<typeof correctorSchema>;
export type AnyModelInfo = ModelInfo | CorrectorInfo;

export const DEFAULT_MODEL_ID = 'glm-ocr-q8';
export const DEFAULT_CORRECTOR_ID = 'gemma-4-e2b-q4';

export function parseRegistry(json: unknown): readonly AnyModelInfo[] {
  const { models } = registrySchema.parse(json);
  for (const [id, role] of [
    [DEFAULT_MODEL_ID, 'transcriber'],
    [DEFAULT_CORRECTOR_ID, 'corrector'],
  ] as const) {
    if (!models.some((model) => model.id === id && model.role === role)) {
      throw new Error(`Die Modellliste enthält das Standardmodell ${id} nicht.`);
    }
  }
  return models;
}

export const ALL_MODELS: readonly AnyModelInfo[] = parseRegistry(registryJson);

export const MODELS: readonly ModelInfo[] = ALL_MODELS.filter(
  (model): model is ModelInfo => model.role === 'transcriber',
);

export const CORRECTORS: readonly CorrectorInfo[] = ALL_MODELS.filter(
  (model): model is CorrectorInfo => model.role === 'corrector',
);

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((model) => model.id === id);
}

export function findCorrector(id: string): CorrectorInfo | undefined {
  return CORRECTORS.find((model) => model.id === id);
}

export function defaultCorrector(): CorrectorInfo {
  const corrector = findCorrector(DEFAULT_CORRECTOR_ID);
  if (corrector === undefined) throw new Error('Die Modellliste enthält kein Korrekturmodell.');
  return corrector;
}

export function modelFiles(model: AnyModelInfo) {
  return model.role === 'transcriber'
    ? [model.files.model, model.files.mmproj]
    : [model.files.model];
}

export function totalBytes(model: AnyModelInfo): number {
  return modelFiles(model).reduce((sum, file) => sum + file.bytes, 0);
}

export function recommendedRamBytes(model: AnyModelInfo): number {
  return model.recommendedRamGb * GIB;
}

export function isLowOnMemory(model: AnyModelInfo, totalRamBytes: number): boolean {
  return totalRamBytes < recommendedRamBytes(model) * LOW_RAM_TOLERANCE;
}

const DEFAULT_IDS: ReadonlySet<string> = new Set([DEFAULT_MODEL_ID, DEFAULT_CORRECTOR_ID]);

export function recommendModel(): ModelInfo;
export function recommendModel<T extends AnyModelInfo>(models: readonly T[]): T;
export function recommendModel(models: readonly AnyModelInfo[] = MODELS): AnyModelInfo {
  const chosen =
    models.find((model) => DEFAULT_IDS.has(model.id)) ??
    models.reduce<AnyModelInfo | undefined>(
      (smallest, model) =>
        smallest === undefined || model.recommendedRamGb < smallest.recommendedRamGb
          ? model
          : smallest,
      undefined,
    );
  if (chosen === undefined) throw new Error('Die Modellliste ist leer.');
  return chosen;
}

export function offeredModels(totalRamBytes: number | null): readonly ModelInfo[];
export function offeredModels<T extends AnyModelInfo>(
  totalRamBytes: number | null,
  models: readonly T[],
): readonly T[];
export function offeredModels(
  totalRamBytes: number | null,
  models: readonly AnyModelInfo[] = MODELS,
): readonly AnyModelInfo[] {
  const fallback = recommendModel(models);
  return models.filter(
    (model) =>
      model.id === fallback.id || (totalRamBytes !== null && !isLowOnMemory(model, totalRamBytes)),
  );
}

export function choiceModels<T extends AnyModelInfo>(
  totalRamBytes: number | null,
  active: T,
  models: readonly T[],
): readonly T[];
export function choiceModels(totalRamBytes: number | null, active: ModelInfo): readonly ModelInfo[];
export function choiceModels(
  totalRamBytes: number | null,
  active: AnyModelInfo,
  models: readonly AnyModelInfo[] = MODELS,
): readonly AnyModelInfo[] {
  const offered = offeredModels(totalRamBytes, models);
  return models.filter((model) => model.id === active.id || offered.includes(model));
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

export function modelNote(model: AnyModelInfo): ModelNote | null {
  return MODEL_NOTES[model.id] ?? null;
}

export interface ModelSource {
  readonly host: string;
  readonly repository: string;
}

export function modelSource(model: AnyModelInfo): ModelSource {
  const url = new URL(model.files.model.url);
  const [owner, name] = url.pathname.split('/').filter(Boolean);
  return { host: url.hostname, repository: owner && name ? `${owner}/${name}` : url.hostname };
}
