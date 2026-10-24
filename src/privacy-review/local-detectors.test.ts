import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Completion } from '../llm/client.ts';
import type { EngineLease, EngineModel, LlmEngine } from '../llm/engine.ts';
import type { ChatRequest } from '../llm/types.ts';
import { createModelClient, type Invoke, type ModelClient } from '../models/client.ts';
import { DEFAULT_CORRECTOR_ID, DEFAULT_MODEL_ID, DEFAULT_REVIEWER_ID } from '../models/registry.ts';
import {
  LEVELS,
  SECOND_READING_STORAGE_KEY,
  STRONGER_CORRECTOR_ID,
  type StepChoice,
  type Thoroughness,
} from '../models/thoroughness.ts';
import type { ModelState } from '../models/types.ts';
import type { DetectorContext } from '../privacy/types.ts';
import { DetectSetupError } from './detect-error.ts';
import { DETECTORS } from './detect.ts';
import {
  PRIVACY_MODEL_ID,
  PRIVACY_MODEL_MISSING,
  THOROUGH_MIN_RAM_BYTES,
  THOROUGH_PRIVACY_MODEL_ID,
  engineAsk,
  expectedPrivacyModels,
  localDetectors,
  planPrivacyModels,
  tauriUnknownWords,
  type PlanInput,
} from './local-detectors.ts';

const GIB = 1024 ** 3;
const context: DetectorContext = { workName: 'Becker Tom 6a.pdf', language: 'de' };

const E2B = PRIVACY_MODEL_ID;
const E4B = THOROUGH_PRIVACY_MODEL_ID;

const plan = (overrides: Partial<PlanInput> = {}): PlanInput => ({
  thoroughness: 'fast',
  totalRamBytes: 32 * GIB,
  mainReady: true,
  thoroughReady: true,
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('planPrivacyModels', () => {
  it('uses the model ids of the default and the stronger corrector', () => {
    expect(E2B).toBe(DEFAULT_CORRECTOR_ID);
    expect(E4B).toBe(STRONGER_CORRECTOR_ID);
    expect(THOROUGH_MIN_RAM_BYTES).toBe(15 * GIB);
  });

  it.each<[string, Partial<PlanInput>]>([
    ['fast', {}],
    ['thorough', { thoroughness: 'thorough' }],
    ['unknown thoroughness', { thoroughness: null }],
  ])('returns null when E2B is not ready (%s)', (_name, overrides) => {
    expect(planPrivacyModels(plan({ ...overrides, mainReady: false }))).toBeNull();
  });

  it('returns null when E2B is missing even if E4B is ready', () => {
    expect(
      planPrivacyModels(
        plan({ thoroughness: 'veryThorough', mainReady: false, thoroughReady: true }),
      ),
    ).toBeNull();
  });

  it.each<[string, Thoroughness | null]>([
    ['fast', 'fast'],
    ['no matching level', null],
  ])('uses E2B alone for %s', (_name, thoroughness) => {
    expect(planPrivacyModels(plan({ thoroughness }))).toEqual({
      models: [E2B],
      sensitiveModel: E2B,
    });
  });

  it.each<Thoroughness>(['thorough', 'veryThorough'])(
    'uses E2B and E4B with sensitive spans from E4B at %s with enough RAM',
    (thoroughness) => {
      expect(planPrivacyModels(plan({ thoroughness, totalRamBytes: 16 * GIB }))).toEqual({
        models: [E2B, E4B],
        sensitiveModel: E4B,
      });
    },
  );

  it('accepts exactly 15 GiB of RAM', () => {
    expect(
      planPrivacyModels(plan({ thoroughness: 'thorough', totalRamBytes: THOROUGH_MIN_RAM_BYTES })),
    ).toEqual({ models: [E2B, E4B], sensitiveModel: E4B });
  });

  it.each<[string, Partial<PlanInput>]>([
    ['E4B is not ready', { thoroughReady: false }],
    ['RAM is one byte below 15 GiB', { totalRamBytes: THOROUGH_MIN_RAM_BYTES - 1 }],
    ['RAM is 8 GiB', { totalRamBytes: 8 * GIB }],
    ['RAM is unknown', { totalRamBytes: null }],
  ])('falls back to E2B at thorough when %s', (_name, overrides) => {
    expect(planPrivacyModels(plan({ thoroughness: 'thorough', ...overrides }))).toEqual({
      models: [E2B],
      sensitiveModel: E2B,
    });
  });

  it('does not use E4B at fast even with plenty of RAM and E4B ready', () => {
    expect(planPrivacyModels(plan({ thoroughness: 'fast', totalRamBytes: 64 * GIB }))).toEqual({
      models: [E2B],
      sensitiveModel: E2B,
    });
  });
});

const choice = (level: Thoroughness): StepChoice => LEVELS[level];
const ids = (value: ReturnType<typeof expectedPrivacyModels>) => value.map((model) => model.id);

describe('expectedPrivacyModels', () => {
  it('lists E2B only for the fast level', () => {
    expect(ids(expectedPrivacyModels(choice('fast'), 32 * GIB))).toEqual([E2B]);
  });

  it.each<Thoroughness>(['thorough', 'veryThorough'])(
    'lists E2B and E4B for %s with enough RAM',
    (level) => {
      expect(ids(expectedPrivacyModels(choice(level), 16 * GIB))).toEqual([E2B, E4B]);
    },
  );

  it.each<[string, number | null]>([
    ['low RAM', 8 * GIB],
    ['unknown RAM', null],
  ])('lists E2B only at thorough with %s', (_name, ram) => {
    expect(ids(expectedPrivacyModels(choice('thorough'), ram))).toEqual([E2B]);
  });

  it('lists E2B only for a custom choice that matches no level', () => {
    const custom: StepChoice = {
      transcriber: DEFAULT_MODEL_ID,
      corrector: 'eigenes-modell',
      reviewer: DEFAULT_REVIEWER_ID,
      secondReading: true,
    };
    expect(ids(expectedPrivacyModels(custom, 64 * GIB))).toEqual([E2B]);
  });

  it('returns full model infos with files to download', () => {
    const models = expectedPrivacyModels(choice('thorough'), 16 * GIB);
    expect(models).toHaveLength(2);
    for (const model of models) expect(model.files.model.bytes).toBeGreaterThan(0);
  });
});

interface ClientSetup {
  readonly states?: Readonly<Record<string, ModelState | 'error'>>;
  readonly ram?: number | 'error';
  readonly selection?: {
    readonly transcriber?: string | null;
    readonly corrector?: string | null;
    readonly reviewer?: string | null;
  };
}

type Respond = (command: string, args: Record<string, unknown> | undefined) => unknown;

function jsonInvoke(respond: Respond): Invoke {
  return (command, args) => {
    try {
      return Promise.resolve(JSON.parse(JSON.stringify(respond(command, args) ?? null)));
    } catch (error) {
      return Promise.reject(error);
    }
  };
}

function fakeModelClient(setup: ClientSetup = {}): ModelClient {
  return createModelClient(
    jsonInvoke((command, args) => {
      switch (command) {
        case 'model_status': {
          const modelId = String(args?.['modelId']);
          const state = setup.states?.[modelId] ?? 'missing';
          if (state === 'error') throw new Error('Status nicht lesbar');
          return { modelId, state, downloadedBytes: 0, totalBytes: 0 };
        }
        case 'hardware_info':
          if (setup.ram === 'error') throw new Error('Keine Hardwareinfo');
          return { totalRamBytes: setup.ram ?? 8 * GIB, freeDiskBytes: null };
        case 'model_selection':
          return setup.selection?.transcriber ?? null;
        case 'model_corrector_selection':
          return setup.selection?.corrector ?? null;
        case 'model_reviewer_selection':
          return setup.selection?.reviewer ?? null;
        default:
          throw new Error(`unexpected command ${command}`);
      }
    }),
    () => Promise.resolve(() => undefined),
  );
}

function stubSecondReading(on: boolean) {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === SECOND_READING_STORAGE_KEY && on ? 'on' : null),
    setItem: () => undefined,
  });
}

const unusedEngine: Pick<LlmEngine, 'loadedModel'> = { loadedModel: () => null };
const noWords = () => Promise.resolve(new Set<string>());

const thoroughSelection = {
  transcriber: LEVELS.thorough.transcriber,
  corrector: LEVELS.thorough.corrector,
  reviewer: LEVELS.thorough.reviewer,
};

function recordingAsk(replies: Readonly<Record<string, string>> = {}) {
  const asked: string[] = [];
  const ask = (model: string) => {
    asked.push(model);
    return Promise.resolve(replies[model] ?? '{"kennungen":[],"sensibel":[]}');
  };
  return { ask, asked };
}

const sensitiveAnswer = (category: string) =>
  JSON.stringify({ kennungen: [], sensibel: [{ zitat: 'hat Asthma', kategorie: category }] });

describe('localDetectors', () => {
  it('throws a DetectSetupError with the missing-model message when E2B is not ready', async () => {
    const client = fakeModelClient({ states: { [E2B]: 'missing', [E4B]: 'ready' } });
    const prepare = localDetectors({
      client,
      unknownWords: noWords,
      ask: recordingAsk().ask,
      engine: unusedEngine,
    });
    const failure = prepare();
    await expect(failure).rejects.toBeInstanceOf(DetectSetupError);
    await expect(failure).rejects.toMatchObject({ message: PRIVACY_MODEL_MISSING });
  });

  it.each<ModelState>(['downloading', 'verifying', 'unverified', 'corrupt', 'deleting'])(
    'treats E2B in state %s as not ready',
    async (state) => {
      const client = fakeModelClient({ states: { [E2B]: state } });
      const prepare = localDetectors({ client, unknownWords: noWords, engine: unusedEngine });
      await expect(prepare()).rejects.toMatchObject({ message: PRIVACY_MODEL_MISSING });
    },
  );

  it('treats an unreadable E2B status as not ready', async () => {
    const client = fakeModelClient({ states: { [E2B]: 'error' } });
    const prepare = localDetectors({ client, unknownWords: noWords, engine: unusedEngine });
    await expect(prepare()).rejects.toBeInstanceOf(DetectSetupError);
  });

  it('returns the rule detectors followed by the work name, dictionary and model detectors', async () => {
    const client = fakeModelClient({ states: { [E2B]: 'ready' } });
    const prepare = localDetectors({
      client,
      unknownWords: noWords,
      ask: recordingAsk().ask,
      engine: unusedEngine,
    });
    const detectors = await prepare();
    expect(detectors).toHaveLength(DETECTORS.length + 3);
    expect(detectors.slice(0, DETECTORS.length)).toEqual(DETECTORS);
  });

  it('checks the status again on every call, so a model set up later is picked up', async () => {
    const states: Record<string, ModelState> = { [E2B]: 'missing' };
    const client = fakeModelClient({ states });
    const prepare = localDetectors({ client, unknownWords: noWords, engine: unusedEngine });
    await expect(prepare()).rejects.toBeInstanceOf(DetectSetupError);
    states[E2B] = 'ready';
    await expect(prepare()).resolves.toHaveLength(DETECTORS.length + 3);
  });

  it('asks only E2B for the default level', async () => {
    const client = fakeModelClient({
      states: { [E2B]: 'ready', [E4B]: 'ready' },
      ram: 32 * GIB,
    });
    const { ask, asked } = recordingAsk();
    stubSecondReading(false);
    const detectors = await localDetectors({
      client,
      unknownWords: noWords,
      ask,
      engine: unusedEngine,
    })();
    await detectors.at(-1)?.(['Lena Becker'], context, new AbortController().signal);
    expect(asked).toEqual([E2B]);
  });

  it('asks E2B and E4B at the thorough level with enough RAM', async () => {
    stubSecondReading(true);
    const client = fakeModelClient({
      states: { [E2B]: 'ready', [E4B]: 'ready' },
      ram: 16 * GIB,
      selection: thoroughSelection,
    });
    const { ask, asked } = recordingAsk();
    const detectors = await localDetectors({
      client,
      unknownWords: noWords,
      ask,
      engine: unusedEngine,
    })();
    await detectors.at(-1)?.(['Lena Becker'], context, new AbortController().signal);
    expect(asked).toEqual([E2B, E4B]);
  });

  it('shows sensitive spans from E4B only at the thorough level', async () => {
    stubSecondReading(true);
    const client = fakeModelClient({
      states: { [E2B]: 'ready', [E4B]: 'ready' },
      ram: 16 * GIB,
      selection: thoroughSelection,
    });
    const { ask } = recordingAsk({
      [E2B]: sensitiveAnswer('Gesundheit'),
      [E4B]: sensitiveAnswer('Lebensumstände'),
    });
    const detectors = await localDetectors({
      client,
      unknownWords: noWords,
      ask,
      engine: unusedEngine,
    })();
    const spans = await detectors.at(-1)?.(
      ['Kalle hat Asthma.'],
      context,
      new AbortController().signal,
    );
    expect(spans?.map((span) => span.category)).toEqual(['circumstances']);
  });

  it.each<[string, ClientSetup]>([
    ['E4B is missing', { states: { [E2B]: 'ready' }, ram: 32 * GIB, selection: thoroughSelection }],
    [
      'RAM is low',
      {
        states: { [E2B]: 'ready', [E4B]: 'ready' },
        ram: 8 * GIB,
        selection: thoroughSelection,
      },
    ],
    [
      'the hardware info cannot be read',
      {
        states: { [E2B]: 'ready', [E4B]: 'ready' },
        ram: 'error',
        selection: thoroughSelection,
      },
    ],
  ])('falls back to E2B at the thorough level when %s', async (_name, setup) => {
    stubSecondReading(true);
    const client = fakeModelClient(setup);
    const { ask, asked } = recordingAsk();
    const detectors = await localDetectors({
      client,
      unknownWords: noWords,
      ask,
      engine: unusedEngine,
    })();
    await detectors.at(-1)?.(['Lena Becker'], context, new AbortController().signal);
    expect(asked).toEqual([E2B]);
  });

  it('keeps working with E2B when the stored selection cannot be read', async () => {
    stubSecondReading(true);
    const client = createModelClient(
      jsonInvoke((command, args) => {
        if (command === 'model_status') return { modelId: args?.['modelId'], state: 'ready' };
        throw new Error('kaputt');
      }),
      () => Promise.resolve(() => undefined),
    );
    const { ask, asked } = recordingAsk();
    const detectors = await localDetectors({
      client,
      unknownWords: noWords,
      ask,
      engine: unusedEngine,
    })();
    await detectors.at(-1)?.(['Lena Becker'], context, new AbortController().signal);
    expect(asked).toEqual([E2B]);
  });

  it('asks the model the engine has loaded first', async () => {
    stubSecondReading(true);
    const client = fakeModelClient({
      states: { [E2B]: 'ready', [E4B]: 'ready' },
      ram: 16 * GIB,
      selection: thoroughSelection,
    });
    const { ask, asked } = recordingAsk();
    const detectors = await localDetectors({
      client,
      unknownWords: noWords,
      ask,
      engine: { loadedModel: () => E4B },
    })();
    await detectors.at(-1)?.(['Lena Becker'], context, new AbortController().signal);
    expect(asked).toEqual([E4B, E2B]);
  });

  it('feeds the dictionary detector with the injected unknown words lookup', async () => {
    const client = fakeModelClient({ states: { [E2B]: 'ready' } });
    const lookups: string[][] = [];
    const unknownWords = (words: readonly string[]) => {
      lookups.push([...words]);
      return Promise.resolve(new Set(words.filter((word) => word.toLowerCase() === 'zorbian')));
    };
    const detectors = await localDetectors({
      client,
      unknownWords,
      ask: recordingAsk().ask,
      engine: unusedEngine,
    })();
    const dictionary = detectors.at(-2);
    const lines = ['Heute war Zorbian da.'];
    const spans = await dictionary?.(lines, context, new AbortController().signal);
    expect(lookups.flat()).toContain('Zorbian');
    expect(spans?.map((span) => lines[0]?.slice(span.offset, span.offset + span.length))).toEqual([
      'Zorbian',
    ]);
  });
});

function fakeEngine() {
  const events: string[] = [];
  const acquired: { model: EngineModel; signal: AbortSignal }[] = [];
  let failAcquire: Error | null = null;
  const lease: EngineLease = {
    startupMs: 0,
    release: () => {
      events.push('release');
    },
  };
  const engine: LlmEngine = {
    acquire: (model, signal) => {
      events.push('acquire');
      acquired.push({ model, signal });
      return failAcquire === null ? Promise.resolve(lease) : Promise.reject(failAcquire);
    },
    monitor: () => ({ getPhase: () => 'idle', subscribe: () => () => undefined }),
    markFailed: () => undefined,
    reset: () => Promise.resolve(),
    loadedModel: () => null,
  };
  return {
    engine,
    events,
    acquired,
    failAcquire: (error: Error) => {
      failAcquire = error;
    },
  };
}

function fakeLlm(behaviour: () => Promise<Completion>) {
  const requests: { request: ChatRequest; signal: AbortSignal | undefined; events: string[] }[] =
    [];
  return {
    requests,
    complete: (request: ChatRequest, options?: { signal?: AbortSignal }) => {
      requests.push({ request, signal: options?.signal, events: [] });
      return behaviour();
    },
  };
}

function deferred<T>() {
  const handlers: { resolve: (value: T) => void } = { resolve: () => undefined };
  const promise = new Promise<T>((resolve) => {
    handlers.resolve = resolve;
  });
  return { promise, resolve: (value: T) => handlers.resolve(value) };
}

const request: ChatRequest = { messages: [{ role: 'user', content: 'Text' }], temperature: 0 };
const reply = (text: string): Completion => ({ text, finishReason: 'stop' });

describe('engineAsk', () => {
  it('acquires the model, completes the request and returns the text', async () => {
    const { engine, acquired } = fakeEngine();
    const llm = fakeLlm(() => Promise.resolve(reply('{"kennungen":[]}')));
    const controller = new AbortController();
    const text = await engineAsk(engine, llm)(E4B, request, controller.signal);
    expect(text).toBe('{"kennungen":[]}');
    expect(acquired).toHaveLength(1);
    expect(acquired[0]?.model.id).toBe(E4B);
    expect(acquired[0]?.model.files.model.bytes).toBeGreaterThan(0);
    expect(acquired[0]?.signal).toBe(controller.signal);
    expect(llm.requests).toHaveLength(1);
    expect(llm.requests[0]?.request).toBe(request);
    expect(llm.requests[0]?.signal).toBe(controller.signal);
  });

  it('releases the lease only after the completion finished', async () => {
    const { engine, events } = fakeEngine();
    const gate = deferred<Completion>();
    const llm = fakeLlm(() => {
      events.push('complete');
      return gate.promise;
    });
    const pending = engineAsk(engine, llm)(E2B, request, new AbortController().signal);
    await vi.waitFor(() => {
      expect(events).toEqual(['acquire', 'complete']);
    });
    gate.resolve(reply('fertig'));
    await expect(pending).resolves.toBe('fertig');
    expect(events).toEqual(['acquire', 'complete', 'release']);
  });

  it('releases the lease when the completion fails and rethrows the error', async () => {
    const { engine, events } = fakeEngine();
    const llm = fakeLlm(() => Promise.reject(new Error('Server abgestürzt')));
    await expect(
      engineAsk(engine, llm)(E2B, request, new AbortController().signal),
    ).rejects.toThrow('Server abgestürzt');
    expect(events).toEqual(['acquire', 'release']);
  });

  it('neither completes nor releases when the lease cannot be acquired', async () => {
    const { engine, events, failAcquire } = fakeEngine();
    failAcquire(new Error('abgebrochen'));
    const llm = fakeLlm(() => Promise.resolve(reply('x')));
    await expect(
      engineAsk(engine, llm)(E2B, request, new AbortController().signal),
    ).rejects.toThrow('abgebrochen');
    expect(llm.requests).toEqual([]);
    expect(events).toEqual(['acquire']);
  });

  it('releases a lease per call, also for consecutive questions', async () => {
    const { engine, events } = fakeEngine();
    const llm = fakeLlm(() => Promise.resolve(reply('x')));
    const ask = engineAsk(engine, llm);
    await ask(E2B, request, new AbortController().signal);
    await ask(E4B, request, new AbortController().signal);
    expect(events).toEqual(['acquire', 'release', 'acquire', 'release']);
  });

  it('rejects an unknown model with the missing-model setup error before touching the engine', async () => {
    const { engine, events } = fakeEngine();
    const llm = fakeLlm(() => Promise.resolve(reply('x')));
    const result = engineAsk(engine, llm)('gibt-es-nicht', request, new AbortController().signal);
    await expect(result).rejects.toBeInstanceOf(DetectSetupError);
    await expect(result).rejects.toMatchObject({ message: PRIVACY_MODEL_MISSING });
    expect(events).toEqual([]);
    expect(llm.requests).toEqual([]);
  });

  it('does not accept transcriber models as privacy models', async () => {
    const { engine, events } = fakeEngine();
    const llm = fakeLlm(() => Promise.resolve(reply('x')));
    const result = engineAsk(engine, llm)(DEFAULT_MODEL_ID, request, new AbortController().signal);
    await expect(result).rejects.toBeInstanceOf(DetectSetupError);
    expect(events).toEqual([]);
  });
});

function fakeInvoke(result: string[]) {
  const calls: { command: string; args: Record<string, unknown> | undefined }[] = [];
  const invoke = jsonInvoke((command, args) => {
    calls.push({ command, args });
    return result;
  });
  return { invoke, calls };
}

const failingInvoke: Invoke = () => Promise.reject(new Error('Wörterbuch fehlt'));

describe('tauriUnknownWords', () => {
  it('asks privacy_unknown_words with the words and returns them as a set', async () => {
    const { invoke, calls } = fakeInvoke(['Zorbian', 'Zorbian', 'Quelle']);
    const unknown = await tauriUnknownWords(invoke)(
      ['Zorbian', 'Haus', 'Quelle'],
      new AbortController().signal,
    );
    expect(calls).toEqual([
      { command: 'privacy_unknown_words', args: { words: ['Zorbian', 'Haus', 'Quelle'] } },
    ]);
    expect(unknown).toEqual(new Set(['Zorbian', 'Quelle']));
  });

  it('returns an empty set when Rust knows every word', async () => {
    const { invoke } = fakeInvoke([]);
    const unknown = await tauriUnknownWords(invoke)(['Haus'], new AbortController().signal);
    expect(unknown.size).toBe(0);
  });

  it('rejects without calling Rust when the signal is already aborted', async () => {
    const { invoke, calls } = fakeInvoke([]);
    const controller = new AbortController();
    controller.abort(new Error('abgebrochen'));
    await expect(tauriUnknownWords(invoke)(['Haus'], controller.signal)).rejects.toThrow(
      'abgebrochen',
    );
    expect(calls).toEqual([]);
  });

  it('passes errors from Rust on', async () => {
    await expect(
      tauriUnknownWords(failingInvoke)(['Haus'], new AbortController().signal),
    ).rejects.toThrow('Wörterbuch fehlt');
  });
});
