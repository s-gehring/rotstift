import { describe, expect, it } from 'vitest';
import { TRANSCRIBE_PROMPT } from '../../eval/models.ts';
import {
  MODELS,
  DEFAULT_MODEL_ID,
  findModel,
  isLowOnMemory,
  modelNote,
  modelSource,
  offeredModels,
  recommendModel,
  totalBytes,
  type ModelInfo,
} from './registry.ts';

const GIB = 1024 ** 3;
const model = recommendModel();

const ids = (ram: number | null) => offeredModels(ram).map((entry) => entry.id);

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

  it('keeps GLM-OCR as the default and lists the stronger model second', () => {
    expect(MODELS.map((entry) => entry.id)).toEqual([DEFAULT_MODEL_ID, 'qwen3-vl-4b-q4']);
    expect(recommendModel().id).toBe(DEFAULT_MODEL_ID);
  });

  it('describes the stronger model with the evaluated values and the evaluation prompt', () => {
    const stronger = findModel('qwen3-vl-4b-q4');
    expect(stronger).toMatchObject({
      displayName: 'Qwen3-VL 4B Instruct (Q4_K_M)',
      license: 'Apache-2.0',
      recommendedRamGb: 16,
      server: { contextSize: 4096, imageMaxTokens: 1024, threads: null, gpuLayers: null },
      request: { maxOutputTokens: 2048, temperature: 0, imageMaxEdge: 1536 },
      prompt: TRANSCRIBE_PROMPT,
    });
    expect(stronger && totalBytes(stronger)).toBe(2_497_281_664 + 453_974_304);
  });

  it('recommends the default on every machine, even a large one', () => {
    for (const ram of [null, 2 * GIB, 8 * GIB, 64 * GIB]) {
      expect(recommendModel().id).toBe(DEFAULT_MODEL_ID);
      expect(offeredModels(ram)[0]?.id).toBe(DEFAULT_MODEL_ID);
    }
    const small = variant('small', 4);
    const large = variant('large', 16);
    expect(recommendModel([large, small]).id).toBe('small');
    expect(recommendModel([variant(DEFAULT_MODEL_ID, 8), large]).id).toBe(DEFAULT_MODEL_ID);
    expect(() => recommendModel([])).toThrow('Modellliste ist leer');
  });

  it('offers the stronger model from 16 GB, with a tolerance for reserved memory', () => {
    expect(ids(null)).toEqual([DEFAULT_MODEL_ID]);
    expect(ids(8 * GIB)).toEqual([DEFAULT_MODEL_ID]);
    expect(ids(12 * GIB)).toEqual([DEFAULT_MODEL_ID]);
    expect(ids(15.7 * GIB)).toEqual([DEFAULT_MODEL_ID, 'qwen3-vl-4b-q4']);
    expect(ids(16 * GIB)).toEqual([DEFAULT_MODEL_ID, 'qwen3-vl-4b-q4']);
    expect(ids(48 * GIB)).toEqual([DEFAULT_MODEL_ID, 'qwen3-vl-4b-q4']);
    expect(offeredModels(2 * GIB, [variant('only', 32)]).map((entry) => entry.id)).toEqual([
      'only',
    ]);
  });

  it('describes speed and accuracy of the stronger model only', () => {
    const note = modelNote(findModel('qwen3-vl-4b-q4') ?? model);
    expect(note?.speed).toContain('doppelt so langsam');
    expect(note?.accuracy).toContain('Wörterzählen');
    expect(modelNote(model)).toBeNull();
  });
});
