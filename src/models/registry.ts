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

const roleSchema = z.enum(['transcriber', 'corrector']);

const registrySchema = z.strictObject({
  customTemplates: z.strictObject({ transcriber: z.string(), corrector: z.string() }),
  models: z.array(z.discriminatedUnion('role', [transcriberSchema, correctorSchema])).min(1),
});

const customFileSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.gguf$/u),
  url: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.number().int().positive(),
});

export const customModelSchema = z.strictObject({
  id: z.string().regex(/^custom-[0-9a-f]{12}$/u),
  role: roleSchema,
  source: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('huggingFace'), repo: z.string(), revision: z.string() }),
    z.strictObject({ kind: z.literal('file') }),
  ]),
  files: z.strictObject({ model: customFileSchema, mmproj: customFileSchema.nullable() }),
});

export type FileRole = z.infer<typeof roleSchema>;
export type CustomModel = z.infer<typeof customModelSchema>;
export type CustomSource = CustomModel['source'];

export type ModelInfo = z.infer<typeof transcriberSchema>;
export type CorrectorInfo = z.infer<typeof correctorSchema>;
export type AnyModelInfo = ModelInfo | CorrectorInfo;

export const DEFAULT_MODEL_ID = 'glm-ocr-q8';
export const DEFAULT_CORRECTOR_ID = 'gemma-4-e2b-q4';
export const DEFAULT_REVIEWER_ID = DEFAULT_CORRECTOR_ID;

function parseRegistryFile(json: unknown) {
  const { models, customTemplates } = registrySchema.parse(json);
  for (const [id, role, kind] of [
    [DEFAULT_MODEL_ID, 'transcriber', 'Standardmodell'],
    [DEFAULT_CORRECTOR_ID, 'corrector', 'Standardmodell'],
    [customTemplates.transcriber, 'transcriber', 'Vorlage'],
    [customTemplates.corrector, 'corrector', 'Vorlage'],
  ] as const) {
    if (!models.some((model) => model.id === id && model.role === role)) {
      throw new Error(`Die Modellliste enthält ${kind} ${id} nicht.`);
    }
  }
  return { models, customTemplates };
}

export function parseRegistry(json: unknown): readonly AnyModelInfo[] {
  return parseRegistryFile(json).models;
}

const REGISTRY = parseRegistryFile(registryJson);

export const ALL_MODELS: readonly AnyModelInfo[] = REGISTRY.models;

export const MODELS: readonly ModelInfo[] = ALL_MODELS.filter(
  (model): model is ModelInfo => model.role === 'transcriber',
);

export const CORRECTORS: readonly CorrectorInfo[] = ALL_MODELS.filter(
  (model): model is CorrectorInfo => model.role === 'corrector',
);

export const REVIEWERS: readonly CorrectorInfo[] = CORRECTORS;

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

export function findReviewer(id: string): CorrectorInfo | undefined {
  return REVIEWERS.find((model) => model.id === id);
}

export function defaultReviewer(): CorrectorInfo {
  const reviewer = findReviewer(DEFAULT_REVIEWER_ID);
  if (reviewer === undefined)
    throw new Error('Die Modellliste enthält kein Modell für Inhalt und Form.');
  return reviewer;
}

export type Sourced<T extends AnyModelInfo> = T & { readonly source?: CustomSource };

function template(role: FileRole): AnyModelInfo {
  const found = ALL_MODELS.find((model) => model.id === REGISTRY.customTemplates[role]);
  if (found === undefined) throw new Error(`Die Modellliste enthält keine Vorlage für ${role}.`);
  return found;
}

export function customEntry(custom: CustomModel): Sourced<AnyModelInfo> {
  const base = template(custom.role);
  const common = {
    id: custom.id,
    displayName: custom.files.model.name,
    license: '',
    source: custom.source,
  };
  if (base.role === 'transcriber') {
    if (custom.files.mmproj === null) throw new Error(`${custom.id} hat keine Bilddatei.`);
    return {
      ...base,
      ...common,
      files: { model: custom.files.model, mmproj: custom.files.mmproj },
      server: { ...base.server, cpuRepack: false },
      request: { ...base.request, uncertainBelow: null },
    };
  }
  return {
    ...base,
    ...common,
    files: { model: custom.files.model },
    server: { ...base.server, cpuRepack: false },
  };
}

export function customSource(model: Sourced<AnyModelInfo>): CustomSource | null {
  return model.source ?? null;
}

const GB = 1e9;
const REPACK_MIN_RAM = 12 * GIB;
const RESERVED_RAM = 3.5 * GIB;

export function estimateRamBytes(model: AnyModelInfo, totalRamBytes: number | null): number {
  const overhead = model.role === 'transcriber' ? 1.4 * GB : 0.65 * GB;
  const repacks =
    model.server.cpuRepack || (totalRamBytes !== null && totalRamBytes >= REPACK_MIN_RAM);
  return totalBytes(model) * 1.05 + overhead + (repacks ? 0.47 * model.files.model.bytes : 0);
}

export function exceedsMemory(model: AnyModelInfo, totalRamBytes: number | null): boolean {
  return (
    totalRamBytes !== null && estimateRamBytes(model, totalRamBytes) > totalRamBytes - RESERVED_RAM
  );
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

export interface ModelSource {
  readonly host: string;
  readonly repository: string;
}

export function modelSource(model: AnyModelInfo): ModelSource {
  const url = new URL(model.files.model.url);
  const [owner, name] = url.pathname.split('/').filter(Boolean);
  return { host: url.hostname, repository: owner && name ? `${owner}/${name}` : url.hostname };
}
