import { describe, expect, it, vi } from 'vitest';
import { LlmCallError, type Completion } from '../llm/client.ts';
import type { LlmError, RuntimeStatus } from '../llm/types.ts';
import { recommendModel } from '../models/registry.ts';
import {
  createLlmTranscriber,
  describeLlmError,
  type EngineClient,
  type LlmTranscriberDeps,
} from './llm-transcriber.ts';

const model = recommendModel(null);

const ready: RuntimeStatus = { state: 'ready', model: model.files.model.name, port: 1 };
const png = new Blob(['x'], { type: 'image/png' });

function deferred<T>() {
  const handle: { resolve: (value: T) => void } = { resolve: () => undefined };
  const promise = new Promise<T>((resolve) => {
    handle.resolve = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      handle.resolve(value);
    },
  };
}

const answer = (text: string, finishReason: string | null = 'stop'): Completion => ({
  text,
  finishReason,
});

function client() {
  return {
    status: vi.fn<EngineClient['status']>(() => Promise.resolve({ state: 'stopped' } as const)),
    startModel: vi.fn<EngineClient['startModel']>(() => Promise.resolve(ready)),
    complete: vi.fn<EngineClient['complete']>(() =>
      Promise.resolve(answer('Hallo Welt\nZweite Zeile')),
    ),
  };
}

function transcriber(engine: EngineClient, extra: Partial<LlmTranscriberDeps> = {}) {
  return createLlmTranscriber({
    client: engine,
    model,
    encode: () => Promise.resolve('data:image/jpeg;base64,AA=='),
    ...extra,
  });
}

describe('createLlmTranscriber', () => {
  it('starts the sidecar lazily with the registry model and sends the registry prompt', async () => {
    const engine = client();
    const instance = transcriber(engine);
    expect(engine.startModel).not.toHaveBeenCalled();
    expect(instance.engine.getPhase()).toBe('idle');

    const result = await instance.transcribe(png, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, lines: ['Hallo Welt', 'Zweite Zeile'] });
    expect(engine.startModel).toHaveBeenCalledExactlyOnceWith(model.id);
    const [request] = engine.complete.mock.calls[0] ?? [];
    expect(request?.max_tokens).toBe(model.request.maxOutputTokens);
    expect(request?.temperature).toBe(model.request.temperature);
    expect(JSON.stringify(request?.messages)).toContain(model.prompt);
    expect(JSON.stringify(request?.messages)).toContain('data:image/jpeg;base64,AA==');
    expect(instance.engine.getPhase()).toBe('ready');
  });

  it('reports the starting phase and keeps a running sidecar for later pages', async () => {
    const start = deferred<RuntimeStatus>();
    const engine = client();
    engine.startModel.mockImplementation(() => start.promise);
    const instance = transcriber(engine);
    const phases: string[] = [];
    instance.engine.subscribe(() => phases.push(instance.engine.getPhase()));

    const first = instance.transcribe(png, new AbortController().signal);
    await vi.waitFor(() => expect(instance.engine.getPhase()).toBe('starting'));
    start.resolve(ready);
    expect((await first).ok).toBe(true);
    expect(phases).toEqual(['starting', 'ready']);

    engine.status.mockResolvedValue(ready);
    await instance.transcribe(png, new AbortController().signal);
    expect(engine.startModel).toHaveBeenCalledOnce();
  });

  it('starts only once for concurrent calls', async () => {
    const engine = client();
    const instance = transcriber(engine);
    const signal = new AbortController().signal;
    await Promise.all([instance.transcribe(png, signal), instance.transcribe(png, signal)]);
    expect(engine.startModel).toHaveBeenCalledOnce();
  });

  it('turns a sidecar crash into an understandable error and restarts on the next attempt', async () => {
    const engine = client();
    engine.status.mockResolvedValue(ready);
    engine.complete.mockRejectedValueOnce(
      new LlmCallError({ kind: 'exitedUnexpectedly', detail: { code: 137, log: '' } }),
    );
    const instance = transcriber(engine);
    const failed = await instance.transcribe(png, new AbortController().signal);
    expect(failed).toMatchObject({
      ok: false,
      error: { kind: 'failed', message: expect.stringContaining('unerwartet beendet') },
    });
    expect(instance.engine.getPhase()).toBe('failed');

    engine.status.mockResolvedValue({
      state: 'failed',
      error: { kind: 'exitedUnexpectedly', detail: { code: 137, log: '' } },
    });
    const retried = await instance.transcribe(png, new AbortController().signal);
    expect(retried.ok).toBe(true);
    expect(engine.startModel).toHaveBeenCalledOnce();
    expect(instance.engine.getPhase()).toBe('ready');
  });

  it('marks sidecar crashes so a batch can stop retrying', async () => {
    const engine = client();
    engine.status.mockResolvedValue(ready);
    engine.complete.mockRejectedValueOnce(
      new LlmCallError({ kind: 'exitedUnexpectedly', detail: { code: 137, log: '' } }),
    );
    const crashed = await transcriber(engine).transcribe(png, new AbortController().signal);
    expect(crashed).toMatchObject({ ok: false, error: { kind: 'failed', crashed: true } });

    engine.complete.mockRejectedValueOnce(new LlmCallError({ kind: 'timeout' }));
    const slow = await transcriber(engine).transcribe(png, new AbortController().signal);
    expect(slow).toMatchObject({ ok: false, error: { kind: 'failed' } });
    expect(!slow.ok && 'crashed' in slow.error).toBe(false);
  });

  it('reports a failed start with the cause', async () => {
    const engine = client();
    engine.startModel.mockRejectedValue(
      new LlmCallError({ kind: 'exitedDuringStartup', detail: { code: 1, log: '' } }),
    );
    const instance = transcriber(engine);
    const result = await instance.transcribe(png, new AbortController().signal);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'failed', message: expect.stringContaining('Arbeitsspeicher') },
    });
    expect(instance.engine.getPhase()).toBe('failed');
  });

  it('cancels through the abort signal', async () => {
    const engine = client();
    engine.status.mockResolvedValue(ready);
    engine.complete.mockImplementation((_request, options) => {
      return new Promise<Completion>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new LlmCallError({ kind: 'cancelled' })),
        );
      });
    });
    const controller = new AbortController();
    const instance = transcriber(engine);
    const pending = instance.transcribe(png, controller.signal);
    await vi.waitFor(() => expect(engine.complete).toHaveBeenCalled());
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: 'cancelled' } });
  });

  it('does not wait for a slow start when cancelled', async () => {
    const engine = client();
    engine.startModel.mockImplementation(() => new Promise<RuntimeStatus>(() => undefined));
    const controller = new AbortController();
    const pending = transcriber(engine).transcribe(png, controller.signal);
    await vi.waitFor(() => expect(engine.startModel).toHaveBeenCalled());
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(engine.complete).not.toHaveBeenCalled();
  });
});

async function run(text: Completion) {
  const engine = client();
  engine.complete.mockResolvedValue(text);
  return transcriber(engine).transcribe(png, new AbortController().signal);
}

describe('incomplete answers', () => {
  it('fails instead of counting a page whose answer was cut off', async () => {
    const result = await run(answer('Erste Zeile\nZweite Zeile\nDritte Zei', 'length'));
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'failed',
        message:
          'Die Antwort des Modells war unvollständig. Bitte die Seite erneut erkennen lassen.',
      },
    });
  });

  it('fails when nothing is left after cleaning the answer', async () => {
    for (const text of ['', '  \n\n', '<think>\nnur gedacht', '```\n\n```']) {
      const result = await run(answer(text));
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'failed', message: expect.stringContaining('unvollständig') },
      });
    }
  });

  it('fails on a repetition loop even when the model stopped by itself', async () => {
    const loop = Array.from({ length: 200 }, () => 'und dann sind wir gegangen').join('\n');
    const result = await run(answer(loop));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'failed', message: expect.stringContaining('Wiederholung') },
    });
  });

  it('accepts a finished answer without a finish reason', async () => {
    expect(await run(answer('Hallo Welt', null))).toMatchObject({
      ok: true,
      lines: ['Hallo Welt'],
    });
  });
});

describe('startup time and availability', () => {
  it('reports the sidecar startup separately from the page work', async () => {
    let clock = 0;
    const engine = client();
    engine.startModel.mockImplementation(() => {
      clock += 18_000;
      return Promise.resolve(ready);
    });
    const instance = transcriber(engine, { now: () => clock });
    const first = await instance.transcribe(png, new AbortController().signal);
    expect(first).toMatchObject({ ok: true, startupMs: 18_000 });

    engine.status.mockResolvedValue(ready);
    const second = await instance.transcribe(png, new AbortController().signal);
    expect(second).toMatchObject({ ok: true, startupMs: 0 });
  });

  it('tells the caller when the model files are gone', async () => {
    const onUnavailable = vi.fn<() => void>();
    const engine = client();
    engine.startModel.mockRejectedValue(new LlmCallError({ kind: 'modelNotFound', detail: 'x' }));
    const result = await transcriber(engine, { onUnavailable }).transcribe(
      png,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(onUnavailable).toHaveBeenCalledOnce();
  });

  it('does not report other failures as unavailable', async () => {
    const onUnavailable = vi.fn<() => void>();
    const engine = client();
    engine.startModel.mockRejectedValue(new LlmCallError({ kind: 'startupTimeout' }));
    await transcriber(engine, { onUnavailable }).transcribe(png, new AbortController().signal);
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});

describe('describeLlmError', () => {
  it('has a German message for every error kind', () => {
    const kinds: LlmError[] = [
      { kind: 'modelNotFound', detail: 'x' },
      { kind: 'invalidModelName', detail: 'x' },
      { kind: 'sidecarMissing', detail: 'x' },
      { kind: 'environment', detail: 'x' },
      { kind: 'spawnFailed', detail: 'x' },
      { kind: 'invalidRequest', detail: 'x' },
      { kind: 'request', detail: 'x' },
      { kind: 'exitedDuringStartup', detail: { code: 1, log: '' } },
      { kind: 'exitedUnexpectedly', detail: { code: 1, log: '' } },
      { kind: 'startupTimeout' },
      { kind: 'notReady' },
      { kind: 'timeout' },
      { kind: 'server', detail: { status: 500, body: '' } },
    ];
    for (const error of kinds) {
      const described = describeLlmError(error);
      expect(described).toMatchObject({ message: expect.stringMatching(/^Die |^Das /u) });
    }
    expect(describeLlmError({ kind: 'cancelled' })).toEqual({ kind: 'cancelled' });
  });
});
