import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { TRANSCRIBE_PROMPT } from '../../eval/models.ts';
import {
  ALL_MODELS,
  CORRECTORS,
  DEFAULT_CORRECTOR_ID,
  MODELS,
  DEFAULT_MODEL_ID,
  defaultCorrector,
  findCorrector,
  parseRegistry,
  choiceModels,
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

const list = (ram: number | null, active: ModelInfo) =>
  choiceModels(ram, active).map((entry) => entry.id);
const ids = (ram: number | null) => offeredModels(ram).map((entry) => entry.id);

const parse =
  (...models: unknown[]) =>
  () =>
    parseRegistry({ models });

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
      request: { maxOutputTokens: 2048, temperature: 0, imageMaxEdge: 1536, uncertainBelow: 0.9 },
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

  it('keeps the active model in the choice even when the machine does not qualify', () => {
    const stronger = findModel('qwen3-vl-4b-q4') ?? model;
    expect(list(null, stronger)).toEqual([DEFAULT_MODEL_ID, 'qwen3-vl-4b-q4']);
    expect(list(8 * GIB, stronger)).toEqual([DEFAULT_MODEL_ID, 'qwen3-vl-4b-q4']);
    expect(list(null, model)).toEqual([DEFAULT_MODEL_ID]);
    expect(list(32 * GIB, model)).toEqual([DEFAULT_MODEL_ID, 'qwen3-vl-4b-q4']);
  });

  it('lists Gemma 4 E2B as the corrector exactly as the evaluation recommends', () => {
    expect(CORRECTORS.map((entry) => entry.id)).toEqual([DEFAULT_CORRECTOR_ID]);
    expect(ALL_MODELS).toHaveLength(MODELS.length + CORRECTORS.length);
    expect(findModel(DEFAULT_CORRECTOR_ID)).toBeUndefined();
    expect(findCorrector(DEFAULT_MODEL_ID)).toBeUndefined();
    const corrector = defaultCorrector();
    expect(corrector).toMatchObject({
      displayName: 'Gemma 4 E2B it (Q4_0)',
      license: 'Apache-2.0',
      recommendedRamGb: 8,
      files: {
        model: {
          name: 'gemma-4-E2B-it-Q4_0.gguf',
          sha256: '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52',
          bytes: 2_841_481_184,
        },
      },
      server: {
        contextSize: 4096,
        threads: null,
        gpuLayers: null,
        cpuRepack: false,
        reasoning: 'off',
      },
      request: { maxOutputTokens: 2048, temperature: 0 },
      lineMode: 'numbered',
      prompt: '{text}',
    });
    expect(corrector.files).not.toHaveProperty('mmproj');
    expect(corrector.system).toMatch(
      /^Du korrigierst die Fehler in einer Schülerarbeit\. Fach: \{subject\}\. Der Text ist auf \{language\} geschrieben\.\n/u,
    );
    expect(corrector.system).toContain('Gib nur die Zeilen aus, ohne Erklärung.');
    expect(totalBytes(corrector)).toBe(2_841_481_184);
    expect(recommendModel(CORRECTORS).id).toBe(DEFAULT_CORRECTOR_ID);
    expect(offeredModels(8 * GIB, CORRECTORS)).toEqual([corrector]);
  });

  it('keeps weight repacking for transcribers', () => {
    expect(MODELS.every((entry) => entry.server.cpuRepack)).toBe(true);
  });

  it('rejects entries that mix up the two roles', () => {
    const transcriber = recommendModel();
    const corrector = defaultCorrector();
    expect(parse(transcriber, corrector)).not.toThrow();
    expect(parse({ ...transcriber, role: 'corrector' }, corrector)).toThrow(ZodError);
    expect(parse({ ...transcriber, role: 'painter' }, corrector)).toThrow(ZodError);
    const withProjector = { ...corrector.files, mmproj: transcriber.files.mmproj };
    expect(parse(transcriber, { ...corrector, files: withProjector })).toThrow(ZodError);
    expect(parse(transcriber, { ...corrector, prompt: 'Korrigiere.' })).toThrow(ZodError);
    expect(parse(transcriber, { ...corrector, lineMode: 'diff' })).toThrow(ZodError);
    expect(parse(transcriber, { ...corrector, system: null })).toThrow(ZodError);
    const withImageTokens = { ...corrector.server, imageMaxTokens: null };
    expect(parse(transcriber, { ...corrector, server: withImageTokens })).toThrow(ZodError);
    const { threads: _threads, ...withoutThreads } = transcriber.server;
    expect(parse({ ...transcriber, server: withoutThreads }, corrector)).toThrow(ZodError);
    const { cpuRepack: _dropped, ...server } = corrector.server;
    expect(parse(transcriber, { ...corrector, server })).toThrow(ZodError);
    const thinking = { ...corrector.server, reasoning: 'on' };
    expect(parse(transcriber, { ...corrector, server: thinking })).toThrow(ZodError);
    expect(parse(transcriber, { ...corrector, id: 'other-corrector' })).toThrow(
      'Standardmodell gemma-4-e2b-q4',
    );
    expect(parse({ ...corrector, id: DEFAULT_MODEL_ID }, corrector)).toThrow(
      'Standardmodell glm-ocr-q8',
    );
  });

  it('takes the reading threshold of each transcriber from the registry', () => {
    expect(recommendModel().request.uncertainBelow).toBe(0.95);
    expect(findModel('qwen3-vl-4b-q4')?.request.uncertainBelow).toBe(0.9);
    const transcriber = recommendModel();
    const corrector = defaultCorrector();
    const withThreshold = (uncertainBelow: unknown) => ({
      ...transcriber,
      request: { ...transcriber.request, uncertainBelow },
    });
    expect(parse(withThreshold(null), corrector)).not.toThrow();
    for (const invalid of [0, 1, 1.2, -0.5, '0.9']) {
      expect(parse(withThreshold(invalid), corrector)).toThrow(ZodError);
    }
    const { uncertainBelow: _omitted, ...withoutThreshold } = transcriber.request;
    expect(parse({ ...transcriber, request: withoutThreshold }, corrector)).toThrow(ZodError);
    const correctorRequest = { ...corrector.request, uncertainBelow: 0.95 };
    expect(parse(transcriber, { ...corrector, request: correctorRequest })).toThrow(ZodError);
  });

  it('describes speed and accuracy of the stronger model only', () => {
    const note = modelNote(findModel('qwen3-vl-4b-q4') ?? model);
    expect(note?.speed).toContain('doppelt so langsam');
    expect(note?.accuracy).toContain('Wörterzählen');
    expect(modelNote(model)).toBeNull();
  });
});
