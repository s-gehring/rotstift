import { describe, expect, it, vi } from 'vitest';
import { defaultCorrector, recommendModel } from '../models/registry.ts';
import { LlmCallError } from './client.ts';
import { createLlmEngine, type EngineClient } from './engine.ts';
import type { RuntimeStatus } from './types.ts';

const transcriber = recommendModel();
const corrector = defaultCorrector();
const ids: Readonly<Record<string, string>> = {
  [transcriber.id]: transcriber.files.model.name,
  [corrector.id]: corrector.files.model.name,
};

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

function fakeRuntime() {
  const calls: string[] = [];
  const gates: Partial<Record<string, Promise<void>>> = {};
  let status: RuntimeStatus = { state: 'stopped' };
  const client = {
    status: vi.fn<EngineClient['status']>(() => Promise.resolve(status)),
    startModel: vi.fn<EngineClient['startModel']>(async (modelId) => {
      const model = ids[modelId] ?? modelId;
      calls.push(`start ${modelId}`);
      status = { state: 'starting', model };
      await gates[modelId];
      status = { state: 'ready', model, port: 1 };
      return status;
    }),
    stop: vi.fn<() => Promise<RuntimeStatus>>(() => {
      calls.push('stop');
      status = { state: 'stopped' };
      return Promise.resolve(status);
    }),
    complete: vi.fn<EngineClient['complete']>(() =>
      Promise.resolve({ text: '', finishReason: 'stop' }),
    ),
  };
  return {
    client,
    calls,
    gates,
    crash: () => {
      status = {
        state: 'failed',
        error: { kind: 'exitedUnexpectedly', detail: { code: 9, log: '' } },
      };
    },
  };
}

const signal = () => new AbortController().signal;

describe('createLlmEngine', () => {
  it('starts the requested model once and keeps it for the next requests', async () => {
    const { client, calls } = fakeRuntime();
    const engine = createLlmEngine(client);
    const monitor = engine.monitor(transcriber.id);
    expect(monitor.getPhase()).toBe('idle');

    const [first, second] = await Promise.all([
      engine.acquire(transcriber, signal()),
      engine.acquire(transcriber, signal()),
    ]);
    expect(calls).toEqual([`start ${transcriber.id}`]);
    expect(monitor.getPhase()).toBe('ready');
    first.release();
    second.release();

    (await engine.acquire(transcriber, signal())).release();
    expect(calls).toEqual([`start ${transcriber.id}`]);
    expect(engine.loadedModel()).toBe(transcriber.id);
  });

  it('waits for the running transcription, then stops it and starts the corrector', async () => {
    const { client, calls } = fakeRuntime();
    const engine = createLlmEngine(client);
    const page = await engine.acquire(transcriber, signal());

    let granted = false;
    const correction = engine.acquire(corrector, signal()).then((lease) => {
      granted = true;
      return lease;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(granted).toBe(false);
    expect(calls).toEqual([`start ${transcriber.id}`]);

    page.release();
    const lease = await correction;
    expect(calls).toEqual([`start ${transcriber.id}`, 'stop', `start ${corrector.id}`]);
    expect(engine.monitor(corrector.id).getPhase()).toBe('ready');
    expect(engine.monitor(transcriber.id).getPhase()).toBe('idle');
    lease.release();

    (await engine.acquire(transcriber, signal())).release();
    expect(calls.slice(3)).toEqual(['stop', `start ${transcriber.id}`]);
  });

  it('serves requests in order so a waiting switch is not overtaken', async () => {
    const { client, calls } = fakeRuntime();
    const engine = createLlmEngine(client);
    const page = await engine.acquire(transcriber, signal());
    const order: string[] = [];
    const correction = engine.acquire(corrector, signal()).then((lease) => {
      order.push('corrector');
      lease.release();
    });
    const nextPage = engine.acquire(transcriber, signal()).then((lease) => {
      order.push('transcriber');
      lease.release();
    });
    page.release();
    await Promise.all([correction, nextPage]);
    expect(order).toEqual(['corrector', 'transcriber']);
    expect(calls).toEqual([
      `start ${transcriber.id}`,
      'stop',
      `start ${corrector.id}`,
      'stop',
      `start ${transcriber.id}`,
    ]);
  });

  it('cancels a request during the switch and leaves the engine usable', async () => {
    const { client, calls, gates } = fakeRuntime();
    const engine = createLlmEngine(client);
    (await engine.acquire(transcriber, signal())).release();

    const slow = deferred<undefined>();
    gates[corrector.id] = slow.promise;
    const controller = new AbortController();
    const correction = engine.acquire(corrector, controller.signal);
    await vi.waitFor(() => expect(calls).toContain(`start ${corrector.id}`));
    expect(engine.monitor(corrector.id).getPhase()).toBe('starting');
    controller.abort();
    await expect(correction).rejects.toEqual(new LlmCallError({ kind: 'cancelled' }));

    const page = engine.acquire(transcriber, signal());
    slow.resolve(undefined);
    (await page).release();
    expect(calls).toEqual([
      `start ${transcriber.id}`,
      'stop',
      `start ${corrector.id}`,
      'stop',
      `start ${transcriber.id}`,
    ]);
    expect(engine.monitor(transcriber.id).getPhase()).toBe('ready');
  });

  it('cancels a request that waits for another one without touching the server', async () => {
    const { client, calls } = fakeRuntime();
    const engine = createLlmEngine(client);
    const page = await engine.acquire(transcriber, signal());
    const controller = new AbortController();
    const correction = engine.acquire(corrector, controller.signal);
    controller.abort();
    await expect(correction).rejects.toBeInstanceOf(LlmCallError);
    page.release();
    await Promise.resolve();
    expect(calls).toEqual([`start ${transcriber.id}`]);
    await expect(engine.acquire(corrector, controller.signal)).rejects.toBeInstanceOf(LlmCallError);
  });

  it('reports a failed start to every request waiting for that model', async () => {
    const { client } = fakeRuntime();
    client.startModel.mockResolvedValueOnce({ state: 'failed', error: { kind: 'startupTimeout' } });
    const engine = createLlmEngine(client);
    const error = new LlmCallError({ kind: 'startupTimeout' });
    await expect(
      Promise.all([engine.acquire(corrector, signal()), engine.acquire(corrector, signal())]),
    ).rejects.toEqual(error);
    expect(engine.monitor(corrector.id).getPhase()).toBe('failed');

    (await engine.acquire(corrector, signal())).release();
    expect(engine.monitor(corrector.id).getPhase()).toBe('ready');
  });

  it('restarts a model whose server has died', async () => {
    const { client, calls, crash } = fakeRuntime();
    const engine = createLlmEngine(client);
    (await engine.acquire(corrector, signal())).release();
    crash();
    engine.markFailed(corrector.id);
    expect(engine.monitor(corrector.id).getPhase()).toBe('failed');
    (await engine.acquire(corrector, signal())).release();
    expect(calls).toEqual([`start ${corrector.id}`, `start ${corrector.id}`]);
  });

  it('adopts a server that already serves the model', async () => {
    const { client } = fakeRuntime();
    client.status.mockResolvedValue({ state: 'ready', model: corrector.files.model.name, port: 2 });
    const engine = createLlmEngine(client);
    const lease = await engine.acquire(corrector, signal());
    expect(lease.startupMs).toBe(0);
    expect(client.startModel).not.toHaveBeenCalled();
    expect(client.stop).not.toHaveBeenCalled();
  });

  it('measures the startup time of a switch', async () => {
    const { client } = fakeRuntime();
    let clock = 0;
    client.startModel.mockImplementationOnce(() => {
      clock += 2500;
      return Promise.resolve({ state: 'ready', model: corrector.files.model.name, port: 3 });
    });
    const engine = createLlmEngine(client, () => clock);
    expect((await engine.acquire(corrector, signal())).startupMs).toBe(2500);
  });

  it('drops stale holders on reset so a recovered engine does not wait for them', async () => {
    const { client, calls } = fakeRuntime();
    const engine = createLlmEngine(client);
    const stuck = await engine.acquire(transcriber, signal());
    const phases: string[] = [];
    engine.monitor(transcriber.id).subscribe(() => {
      phases.push(engine.monitor(transcriber.id).getPhase());
    });
    await engine.reset();
    expect(phases).toEqual(['idle']);
    (await engine.acquire(corrector, signal())).release();
    stuck.release();
    stuck.release();
    expect(calls).toEqual([`start ${transcriber.id}`, 'stop', `start ${corrector.id}`]);
    const twice = await Promise.all([
      engine.acquire(corrector, signal()),
      engine.acquire(corrector, signal()),
    ]);
    for (const lease of twice) lease.release();
    expect(client.startModel).toHaveBeenCalledTimes(2);
  });
});
