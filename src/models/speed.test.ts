import { describe, expect, it } from 'vitest';
import {
  ALL_MODELS,
  CORRECTORS,
  secondReader,
  type AnyModelInfo,
  type CorrectorInfo,
} from './registry.ts';
import { CLOUD_COST, FROM_DISK_SLOWDOWN, relativeTime, stepCosts } from './speed.ts';

const GIB = 1024 ** 3;

const model = (id: string): AnyModelInfo => {
  const found = ALL_MODELS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no model ${id}`);
  return found;
};

const GLM = model('glm-ocr-q8');
const E2B = model('gemma-4-e2b-q4');
const E4B = model('gemma-4-e4b-q4');
const LARGEST = model('gemma-4-26b-a4b-q4');

describe('relativeTime', () => {
  it('measures every pinned model against the default of its step', () => {
    for (const candidate of ALL_MODELS) {
      expect(relativeTime(candidate, 64 * GIB)).toBeGreaterThan(0);
    }
    expect(relativeTime(GLM, 64 * GIB)).toBe(1);
    expect(relativeTime(E2B, 64 * GIB)).toBe(1);
    expect(relativeTime(E4B, 64 * GIB)).toBeGreaterThan(1);
    expect(relativeTime(LARGEST, 64 * GIB)).toBeGreaterThan(relativeTime(E4B, 64 * GIB));
    expect(relativeTime(secondReader(), 64 * GIB)).toBeLessThan(1);
  });

  it('slows a model down that has to be read from the disk', () => {
    expect(relativeTime(E4B, 8 * GIB)).toBe(relativeTime(E4B, 64 * GIB) * FROM_DISK_SLOWDOWN);
    expect(relativeTime(LARGEST, 16 * GIB)).toBe(
      relativeTime(LARGEST, 64 * GIB) * FROM_DISK_SLOWDOWN,
    );
    expect(relativeTime(E2B, 8 * GIB)).toBe(1);
    expect(relativeTime(E4B, null)).toBe(relativeTime(E4B, 64 * GIB));
  });

  it('scales an own model by its size against the default', () => {
    const base = CORRECTORS.find((candidate) => candidate.id === E2B.id);
    if (base === undefined) throw new Error('no default corrector');
    const own: CorrectorInfo = {
      ...base,
      id: 'custom-double',
      files: { model: { ...base.files.model, bytes: base.files.model.bytes * 2 } },
    };
    expect(relativeTime(own, 64 * GIB)).toBeCloseTo(2);
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
      { transcriber: GLM, second: secondReader(), corrector: E4B, reviewer: E4B },
      null,
    );
    expect(thorough.read).toEqual({ key: 'glm-ocr-q8', factor: 1 });
    expect(thorough.confirm).toEqual({
      key: 'lightonocr-3-08b-q8',
      factor: relativeTime(secondReader(), null),
    });
    expect(thorough.correct).toEqual({ key: 'gemma-4-e4b-q4', factor: relativeTime(E4B, null) });
  });

  it('keeps a cloud step apart from the local models', () => {
    const costs = stepCosts(
      { transcriber: null, second: secondReader(), corrector: null, reviewer: E2B },
      8 * GIB,
    );
    expect(costs.read).toEqual(CLOUD_COST);
    expect(costs.confirm).toEqual({ key: 'none', factor: 1 });
    expect(costs.correct).toEqual(CLOUD_COST);
    expect(costs.review.key).toBe('gemma-4-e2b-q4');
  });
});
