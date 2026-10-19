import { describe, expect, it } from 'vitest';
import {
  MODELS,
  isLowOnMemory,
  modelSource,
  recommendModel,
  totalBytes,
  type ModelInfo,
} from './registry.ts';

const GIB = 1024 ** 3;
const model = recommendModel(null);

function variant(id: string, recommendedRamGb: number): ModelInfo {
  return { ...model, id, recommendedRamGb };
}

describe('registry', () => {
  it('lists pinned Hugging Face downloads with hashes and sizes', () => {
    expect(MODELS.length).toBeGreaterThan(0);
    for (const entry of MODELS) {
      for (const file of [entry.files.model, entry.files.mmproj]) {
        expect(file.url).toMatch(/^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//u);
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
        expect(file.bytes).toBeGreaterThan(0);
      }
      expect(entry.prompt.length).toBeGreaterThan(0);
    }
    expect(totalBytes(model)).toBe(model.files.model.bytes + model.files.mmproj.bytes);
  });

  it('describes the source for the setup dialog', () => {
    expect(modelSource(model)).toEqual({
      host: 'huggingface.co',
      repository: expect.stringMatching(/^[^/]+\/[^/]+$/u),
    });
  });

  it('warns below the recommended memory with a tolerance for reserved memory', () => {
    expect(isLowOnMemory(model, model.recommendedRamGb * GIB)).toBe(false);
    expect(isLowOnMemory(model, model.recommendedRamGb * GIB * 0.95)).toBe(false);
    expect(isLowOnMemory(model, 4 * GIB)).toBe(true);
  });

  it('recommends the largest model that fits and the smallest one otherwise', () => {
    const small = variant('small', 4);
    const large = variant('large', 16);
    const models = [small, large];
    expect(recommendModel(32 * GIB, models).id).toBe('large');
    expect(recommendModel(8 * GIB, models).id).toBe('small');
    expect(recommendModel(2 * GIB, models).id).toBe('small');
    expect(recommendModel(null, models).id).toBe('small');
  });
});
