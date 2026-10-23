import {
  ALL_MODELS,
  DEFAULT_CORRECTOR_ID,
  DEFAULT_MODEL_ID,
  draftFile,
  modelBudget,
  totalBytes,
  type AnyModelInfo,
} from './registry.ts';

export type CostStep = 'read' | 'confirm' | 'detect' | 'correct' | 'review';

const RELATIVE_TIME: Readonly<Record<string, Readonly<Partial<Record<CostStep, number>>>>> = {
  'glm-ocr-q8': { read: 1 },
  'qwen3-vl-4b-q4': { read: 3.1 },
  'lightonocr-3-08b-q8': { confirm: 0.9 },
  'gemma-4-e2b-q4': { detect: 1, correct: 1, review: 1 },
  'gemma-4-e4b-q4': { detect: 1.5, correct: 1.95, review: 1.9 },
  'gemma-4-26b-a4b-q4': { correct: 1.9, review: 2.1 },
};

export const DRAFT_SPEEDUP = 0.7;

const TWO_THIRDS_MISSING = 2 / 3;
const SLOWDOWN_AT_TWO_THIRDS = 12;

function reference(model: AnyModelInfo): AnyModelInfo | undefined {
  const id = model.role === 'transcriber' ? DEFAULT_MODEL_ID : DEFAULT_CORRECTOR_ID;
  return ALL_MODELS.find((candidate) => candidate.id === id);
}

function weightBytes(model: AnyModelInfo): number {
  return totalBytes(model) - (draftFile(model)?.bytes ?? 0);
}

export function missingShare(model: AnyModelInfo, totalRamBytes: number | null): number {
  if (totalRamBytes === null) return 0;
  const budget = Math.max(0, modelBudget(totalRamBytes));
  return Math.max(0, 1 - budget / weightBytes(model));
}

export function diskSlowdown(model: AnyModelInfo, totalRamBytes: number | null): number {
  const share = missingShare(model, totalRamBytes) / TWO_THIRDS_MISSING;
  return 1 + (SLOWDOWN_AT_TWO_THIRDS - 1) * share ** 2;
}

function baseTime(model: AnyModelInfo, step: CostStep): number {
  const measured = RELATIVE_TIME[model.id]?.[step];
  if (measured !== undefined) return measured;
  const base = reference(model);
  return base === undefined ? 1 : weightBytes(model) / weightBytes(base);
}

function speculates(model: AnyModelInfo, step: CostStep, draftReady: boolean): boolean {
  return step === 'correct' && draftReady && draftFile(model) !== null;
}

export function relativeTime(
  model: AnyModelInfo,
  step: CostStep,
  totalRamBytes: number | null,
  draftReady = false,
): number {
  const speculation = speculates(model, step, draftReady) ? DRAFT_SPEEDUP : 1;
  return baseTime(model, step) * speculation * diskSlowdown(model, totalRamBytes);
}

export interface StepCost {
  readonly key: string;
  readonly factor: number;
}

export type StepCosts = Readonly<Record<CostStep, StepCost>>;

export interface ChosenModels {
  readonly transcriber: AnyModelInfo | null;
  readonly second: AnyModelInfo | null;
  readonly corrector: AnyModelInfo | null;
  readonly reviewer: AnyModelInfo | null;
  readonly correctorDraft?: boolean;
  readonly detect?: readonly AnyModelInfo[];
}

export const CLOUD_COST: StepCost = { key: 'cloud', factor: 1 };

const NO_COST: StepCost = { key: 'none', factor: 1 };

function single(
  model: AnyModelInfo | null,
  step: CostStep,
  ram: number | null,
  draftReady = false,
): StepCost {
  if (model === null) return CLOUD_COST;
  const key = speculates(model, step, draftReady) ? `${model.id}+mtp` : model.id;
  return { key, factor: relativeTime(model, step, ram, draftReady) };
}

export function stepCosts(models: ChosenModels, totalRamBytes: number | null): StepCosts {
  const { transcriber, second, corrector, reviewer, correctorDraft = false, detect = [] } = models;
  return {
    read: single(transcriber, 'read', totalRamBytes),
    confirm:
      transcriber === null || second === null ? NO_COST : single(second, 'confirm', totalRamBytes),
    detect:
      detect.length === 0
        ? NO_COST
        : {
            key: detect.map((model) => model.id).join('+'),
            factor: detect.reduce(
              (sum, model) => sum + relativeTime(model, 'detect', totalRamBytes),
              0,
            ),
          },
    correct: single(corrector, 'correct', totalRamBytes, correctorDraft),
    review: single(reviewer, 'review', totalRamBytes),
  };
}
