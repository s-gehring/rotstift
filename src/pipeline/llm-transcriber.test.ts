import { describe, expect, it, vi } from 'vitest';
import { LlmCallError } from '../llm/client.ts';
import type { LlmError, RuntimeStatus } from '../llm/types.ts';
import { recommendModel } from '../models/registry.ts';
import { createLlmTranscriber, describeLlmError, type EngineClient } from './llm-transcriber.ts';

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

function client() {
  return {
    status: vi.fn<EngineClient['status']>(() => Promise.resolve({ state: 'stopped' } as const)),
    startModel: vi.fn<EngineClient['startModel']>(() => Promise.resolve(ready)),
    complete: vi.fn<EngineClient['complete']>(() => Promise.resolve('Hallo Welt\nZweite Zeile')),
  };
}

function transcriber(engine: EngineClient) {
  return createLlmTranscriber({
    client: engine,
    model,
    encode: () => Promise.resolve('data:image/jpeg;base64,AA=='),
  });
}

describe('createLlmTranscriber', () => {
  it('starts the sidecar lazily with the registry model and sends the registry prompt', async () => {
    const engine = client();
    const instance = transcriber(engine);
    expect(engine.startModel).not.toHaveBeenCalled();
    expect(instance.engine.getPhase()).toBe('idle');

    const result = await instance.transcribe(png, new AbortController().signal);
    expect(result).toEqual({ ok: true, lines: ['Hallo Welt', 'Zweite Zeile'] });
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
      return new Promise<string>((_resolve, reject) => {
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
