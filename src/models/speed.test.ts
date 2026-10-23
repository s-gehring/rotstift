import { describe, expect, it } from 'vitest';
import {
  ALL_MODELS,
  CORRECTORS,
  secondReader,
  type AnyModelInfo,
  type CorrectorInfo,
} from './registry.ts';
import {
  CLOUD_COST,
  DRAFT_SPEEDUP,
  diskSlowdown,
  missingShare,
  relativeTime,
  stepCosts,
  type CostStep,
} from './speed.ts';

const GIB = 1024 ** 3;

const model = (id: string): AnyModelInfo => {
  const found = ALL_MODELS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no model ${id}`);
  return found;
};

const GLM = model('glm-ocr-q8');
const QWEN = model('qwen3-vl-4b-q4');
const E2B = model('gemma-4-e2b-q4');
const E4B = model('gemma-4-e4b-q4');
const LARGEST = model('gemma-4-26b-a4b-q4');

const STEP_OF: Readonly<Record<AnyModelInfo['role'], CostStep>> = {
  transcriber: 'read',
  corrector: 'correct',
};

describe('relativeTime', () => {
  it('takes the measured factor of each model in each step', () => {
    for (const candidate of ALL_MODELS) {
      expect(relativeTime(candidate, STEP_OF[candidate.role], 64 * GIB)).toBeGreaterThan(0);
    }
    expect(relativeTime(GLM, 'read', 64 * GIB)).toBe(1);
    expect(relativeTime(QWEN, 'read', 64 * GIB)).toBe(3.1);
    expect(relativeTime(secondReader(), 'confirm', 64 * GIB)).toBe(0.9);
    expect(relativeTime(E2B, 'correct', 64 * GIB)).toBe(1);
    expect(relativeTime(E2B, 'review', 64 * GIB)).toBe(1);
    expect(relativeTime(E4B, 'correct', 64 * GIB)).toBe(1.95);
    expect(relativeTime(E4B, 'review', 64 * GIB)).toBe(1.9);
    expect(relativeTime(LARGEST, 'correct', 64 * GIB)).toBe(1.9);
    expect(relativeTime(LARGEST, 'review', 64 * GIB)).toBe(2.1);
  });

  it('follows the table of the measurement on 8 and 16 GB', () => {
    expect(relativeTime(E4B, 'correct', 8 * GIB)).toBe(1.95);
    expect(relativeTime(E4B, 'review', 8 * GIB)).toBe(1.9);
    expect(relativeTime(LARGEST, 'correct', 16 * GIB)).toBeCloseTo(2.2, 1);
    expect(relativeTime(LARGEST, 'review', 16 * GIB)).toBeCloseTo(2.45, 1);
    expect(relativeTime(LARGEST, 'correct', 8 * GIB)).toBeCloseTo(23, 0);
    expect(relativeTime(LARGEST, 'review', 8 * GIB)).toBeCloseTo(25, 0);
  });

  it('speeds up only the correction and only with a head that is really there', () => {
    expect(relativeTime(E2B, 'correct', 8 * GIB, true)).toBe(DRAFT_SPEEDUP);
    expect(relativeTime(E4B, 'correct', 8 * GIB, true)).toBeCloseTo(1.95 * 0.7);
    expect(relativeTime(E2B, 'review', 8 * GIB, true)).toBe(1);
    expect(relativeTime(E2B, 'correct', 8 * GIB, false)).toBe(1);
    const base = CORRECTORS.find((candidate) => candidate.id === E2B.id);
    if (base === undefined) throw new Error('no default corrector');
    const own: CorrectorInfo = { ...base, id: 'custom-plain', files: { model: base.files.model } };
    expect(relativeTime(own, 'correct', 64 * GIB, true)).toBe(1);
  });

  it('scales an own model by the size of its weights against the default', () => {
    const base = CORRECTORS.find((candidate) => candidate.id === E2B.id);
    if (base === undefined) throw new Error('no default corrector');
    const own: CorrectorInfo = {
      ...base,
      id: 'custom-double',
      files: { model: { ...base.files.model, bytes: base.files.model.bytes * 2 } },
    };
    expect(relativeTime(own, 'correct', 64 * GIB)).toBeCloseTo(2);
    expect(relativeTime(own, 'review', 64 * GIB)).toBeCloseTo(2);
  });
});

describe('diskSlowdown', () => {
  it('adds nothing while the weights fit, even if context and buffers do not', () => {
    expect(missingShare(E4B, 8 * GIB)).toBe(0);
    expect(diskSlowdown(E4B, 8 * GIB)).toBe(1);
    expect(diskSlowdown(E2B, 8 * GIB)).toBe(1);
    expect(diskSlowdown(GLM, 8 * GIB)).toBe(1);
    expect(diskSlowdown(LARGEST, 32 * GIB)).toBe(1);
    expect(diskSlowdown(LARGEST, null)).toBe(1);
  });

  it('passes through the measured points of Gemma 4 26B A4B', () => {
    expect(missingShare(LARGEST, 16 * GIB)).toBeCloseTo(0.08, 2);
    expect(diskSlowdown(LARGEST, 16 * GIB)).toBeCloseTo(1.18, 1);
    expect(missingShare(LARGEST, 8 * GIB)).toBeCloseTo(2 / 3, 2);
    expect(diskSlowdown(LARGEST, 8 * GIB)).toBeCloseTo(12, 0);
  });

  it('grows monotonically as less of the model fits', () => {
    let previous = 0;
    for (let ram = 32 * GIB; ram >= 2 * GIB; ram -= GIB / 4) {
      const slowdown = diskSlowdown(LARGEST, ram);
      expect(slowdown).toBeGreaterThanOrEqual(previous);
      previous = slowdown;
    }
    expect(diskSlowdown(LARGEST, 2 * GIB)).toBe(1 + 11 * 1.5 ** 2);
  });
});

describe('stepCosts', () => {
  it('names each step by its model and prices the second reading as its own step', () => {
    const fast = stepCosts({ transcriber: GLM, second: null, corrector: E2B, reviewer: E2B }, null);
    expect(fast).toEqual({
      read: { key: 'glm-ocr-q8', factor: 1 },
      confirm: { key: 'none', factor: 1 },
      correct: { key: 'gemma-4-e2b-q4', factor: 1 },
      review: { key: 'gemma-4-e2b-q4', factor: 1 },
    });
    const thorough = stepCosts(
      { transcriber: GLM, second: secondReader(), corrector: E4B, reviewer: E2B },
      null,
    );
    expect(thorough.read).toEqual({ key: 'glm-ocr-q8', factor: 1 });
    expect(thorough.confirm).toEqual({ key: 'lightonocr-3-08b-q8', factor: 0.9 });
    expect(thorough.correct).toEqual({ key: 'gemma-4-e4b-q4', factor: 1.95 });
    expect(thorough.review).toEqual({ key: 'gemma-4-e2b-q4', factor: 1 });
  });

  it('learns the correction with the head apart from the one without', () => {
    const costs = stepCosts(
      { transcriber: GLM, second: null, corrector: E2B, reviewer: E2B, correctorDraft: true },
      8 * GIB,
    );
    expect(costs.correct).toEqual({ key: 'gemma-4-e2b-q4+mtp', factor: DRAFT_SPEEDUP });
    expect(costs.review).toEqual({ key: 'gemma-4-e2b-q4', factor: 1 });
  });

  it('keeps a cloud step apart from the local models', () => {
    const costs = stepCosts(
      {
        transcriber: null,
        second: secondReader(),
        corrector: null,
        reviewer: E2B,
        correctorDraft: true,
      },
      8 * GIB,
    );
    expect(costs.read).toEqual(CLOUD_COST);
    expect(costs.confirm).toEqual({ key: 'none', factor: 1 });
    expect(costs.correct).toEqual(CLOUD_COST);
    expect(costs.review.key).toBe('gemma-4-e2b-q4');
  });
});
