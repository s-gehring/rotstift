import {
  ALL_MODELS,
  DEFAULT_CORRECTOR_ID,
  DEFAULT_MODEL_ID,
  exceedsMemory,
  totalBytes,
  type AnyModelInfo,
} from './registry.ts';

const RELATIVE_TIME: Readonly<Record<string, number>> = {
  'glm-ocr-q8': 1,
  'qwen3-vl-4b-q4': 3.1,
  'lightonocr-3-08b-q8': 0.65,
  'gemma-4-e2b-q4': 1,
  'gemma-4-e4b-q4': 1.8,
  'gemma-4-26b-a4b-q4': 2.5,
};

export const FROM_DISK_SLOWDOWN = 10;

function reference(model: AnyModelInfo): AnyModelInfo | undefined {
  const id = model.role === 'transcriber' ? DEFAULT_MODEL_ID : DEFAULT_CORRECTOR_ID;
  return ALL_MODELS.find((candidate) => candidate.id === id);
}

export function relativeTime(model: AnyModelInfo, totalRamBytes: number | null): number {
  const base = reference(model);
  const time =
    RELATIVE_TIME[model.id] ?? (base === undefined ? 1 : totalBytes(model) / totalBytes(base));
  return exceedsMemory(model, totalRamBytes) ? time * FROM_DISK_SLOWDOWN : time;
}

export interface StepCost {
  readonly key: string;
  readonly factor: number;
}

export interface StepCosts {
  readonly read: StepCost;
  readonly correct: StepCost;
  readonly review: StepCost;
}

export interface ChosenModels {
  readonly transcriber: AnyModelInfo | null;
  readonly second: AnyModelInfo | null;
  readonly corrector: AnyModelInfo | null;
  readonly reviewer: AnyModelInfo | null;
}

export const CLOUD_COST: StepCost = { key: 'cloud', factor: 1 };

function single(model: AnyModelInfo | null, ram: number | null): StepCost {
  return model === null ? CLOUD_COST : { key: model.id, factor: relativeTime(model, ram) };
}

export function stepCosts(models: ChosenModels, totalRamBytes: number | null): StepCosts {
  const { transcriber, second, corrector, reviewer } = models;
  const read = single(transcriber, totalRamBytes);
  return {
    read:
      transcriber === null || second === null
        ? read
        : {
            key: `${read.key}+${second.id}`,
            factor: read.factor + relativeTime(second, totalRamBytes),
          },
    correct: single(corrector, totalRamBytes),
    review: single(reviewer, totalRamBytes),
  };
}
