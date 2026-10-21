import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { TRANSCRIBE_PROMPT } from '../../eval/models.ts';
import {
  ALL_MODELS,
  CORRECTORS,
  DEFAULT_CORRECTOR_ID,
  MODELS,
  DEFAULT_MODEL_ID,
  DEFAULT_REVIEWER_ID,
  REVIEWERS,
  defaultCorrector,
  defaultReviewer,
  findCorrector,
  findReviewer,
  parseRegistry,
  customEntry,
  customSource,
  estimateRamBytes,
  exceedsMemory,
  findModel,
  modelSource,
  recommendModel,
  totalBytes,
  type CustomModel,
  type ModelInfo,
} from './registry.ts';

const GIB = 1024 ** 3;
const model = recommendModel();

const TEMPLATES = { transcriber: DEFAULT_MODEL_ID, corrector: DEFAULT_CORRECTOR_ID };

const parse =
  (...models: unknown[]) =>
  () =>
    parseRegistry({ customTemplates: TEMPLATES, models });

const customFile = (name: string, digit: string, bytes: number) => ({
  name,
  url: '',
  sha256: digit.repeat(64),
  bytes,
});

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

  it('recommends the default and falls back to the smallest model', () => {
    expect(recommendModel().id).toBe(DEFAULT_MODEL_ID);
    const small = variant('small', 4);
    const large = variant('large', 16);
    expect(recommendModel([large, small]).id).toBe('small');
    expect(recommendModel([variant(DEFAULT_MODEL_ID, 8), large]).id).toBe(DEFAULT_MODEL_ID);
    expect(() => recommendModel([])).toThrow('Modellliste ist leer');
  });

  it('estimates the memory need from the measured peaks', () => {
    const e2b = findCorrector(DEFAULT_CORRECTOR_ID);
    const e4b = findCorrector('gemma-4-e4b-q4');
    if (e2b === undefined || e4b === undefined) throw new Error('missing corrector');
    expect(estimateRamBytes(e2b, 8 * GIB) / 1e9).toBeCloseTo(3.63, 2);
    expect(estimateRamBytes(e4b, 8 * GIB) / 1e9).toBeCloseTo(5.47, 2);
    expect(estimateRamBytes(e4b, 16 * GIB)).toBeGreaterThan(estimateRamBytes(e4b, 8 * GIB));
    expect(estimateRamBytes(model, 8 * GIB)).toBe(estimateRamBytes(model, 16 * GIB));
  });

  it('warns about Gemma 4 E4B on 8 GB but not about the defaults', () => {
    const e4b = findCorrector('gemma-4-e4b-q4');
    if (e4b === undefined) throw new Error('missing corrector');
    expect(exceedsMemory(e4b, 8 * GIB)).toBe(true);
    expect(exceedsMemory(e4b, 16 * GIB)).toBe(false);
    expect(exceedsMemory(e4b, null)).toBe(false);
    expect(exceedsMemory(defaultCorrector(), 8 * GIB)).toBe(false);
    expect(exceedsMemory(recommendModel(), 8 * GIB)).toBe(false);
    expect(exceedsMemory(recommendModel(), 6 * GIB)).toBe(true);
  });

  it('builds a custom text model from the template with its own files', () => {
    const custom: CustomModel = {
      id: 'custom-0123456789ab',
      role: 'corrector',
      source: { kind: 'huggingFace', repo: 'owner/name', revision: 'a'.repeat(40) },
      files: { model: customFile('own.gguf', 'b', 3e9), mmproj: null },
    };
    const entry = customEntry(custom);
    expect(entry).toMatchObject({
      id: custom.id,
      role: 'corrector',
      displayName: 'own.gguf',
      license: '',
      files: { model: custom.files.model },
      system: defaultCorrector().system,
      server: { ...defaultCorrector().server, cpuRepack: false },
    });
    expect(entry.files).not.toHaveProperty('mmproj');
    expect(customSource(entry)).toEqual(custom.source);
    expect(customSource(defaultCorrector())).toBeNull();
  });

  it('builds a custom transcriber without the reading threshold', () => {
    const template = findModel('qwen3-vl-4b-q4');
    const entry = customEntry({
      id: 'custom-ba9876543210',
      role: 'transcriber',
      source: { kind: 'file' },
      files: {
        model: customFile('vision.gguf', 'c', 2e9),
        mmproj: customFile('mmproj.gguf', 'd', 4e8),
      },
    });
    expect(entry).toMatchObject({
      role: 'transcriber',
      prompt: template?.prompt,
      server: { cpuRepack: false },
      request: { uncertainBelow: null },
    });
    expect(totalBytes(entry)).toBe(2.4e9);
    expect(() =>
      customEntry({
        id: 'custom-ba9876543210',
        role: 'transcriber',
        source: { kind: 'file' },
        files: { model: customFile('vision.gguf', 'c', 2e9), mmproj: null },
      }),
    ).toThrow('keine Bilddatei');
  });

  it('requires both custom templates in the registry with the right role', () => {
    const transcriber = recommendModel();
    const corrector = defaultCorrector();
    const withTemplates = (customTemplates: unknown) => () =>
      parseRegistry({ customTemplates, models: [transcriber, corrector] });
    expect(withTemplates(TEMPLATES)).not.toThrow();
    expect(withTemplates({ ...TEMPLATES, corrector: 'missing' })).toThrow('Vorlage missing');
    expect(withTemplates({ ...TEMPLATES, transcriber: DEFAULT_CORRECTOR_ID })).toThrow(
      `Vorlage ${DEFAULT_CORRECTOR_ID}`,
    );
    expect(withTemplates({ transcriber: DEFAULT_MODEL_ID })).toThrow(ZodError);
  });

  it('offers the text models as reviewers without a second registry entry', () => {
    expect(REVIEWERS).toEqual(CORRECTORS);
    expect(DEFAULT_REVIEWER_ID).toBe(DEFAULT_CORRECTOR_ID);
    expect(defaultReviewer()).toBe(defaultCorrector());
    expect(findReviewer(DEFAULT_REVIEWER_ID)).toBe(findCorrector(DEFAULT_CORRECTOR_ID));
    expect(findReviewer(DEFAULT_MODEL_ID)).toBeUndefined();
    expect(
      ALL_MODELS.filter((entry) => entry.files.model.name === defaultReviewer().files.model.name),
    ).toHaveLength(1);
  });

  it('lists Gemma 4 E2B as the corrector exactly as the evaluation recommends', () => {
    expect(CORRECTORS.map((entry) => entry.id)).toEqual([DEFAULT_CORRECTOR_ID, 'gemma-4-e4b-q4']);
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
    expect(findCorrector('gemma-4-e4b-q4')).toMatchObject({
      recommendedRamGb: 16,
      files: { model: { name: 'gemma-4-E4B-it-Q4_0.gguf', bytes: 4_590_807_392 } },
      system: corrector.system,
    });
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
});
