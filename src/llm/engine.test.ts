import { describe, expect, it, vi } from 'vitest';
import { defaultCorrector, recommendModel } from '../models/registry.ts';
import { LlmCallError } from './client.ts';
import { createLlmEngine, IDLE_STOP_MS, type EngineClient, type EngineTimer } from './engine.ts';
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
  let generation = 0;
  const client = {
    status: vi.fn<EngineClient['status']>(() => Promise.resolve(status)),
    startModel: vi.fn<EngineClient['startModel']>(async (modelId) => {
      const model = ids[modelId] ?? modelId;
      calls.push(`start ${modelId}`);
      generation += 1;
      const own = generation;
      status = { state: 'starting', model };
      await gates[modelId];
      if (own !== generation) return status;
      status = { state: 'ready', model, port: 1 };
      return status;
    }),
    stop: vi.fn<() => Promise<RuntimeStatus>>(() => {
      calls.push('stop');
      generation += 1;
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

    const first = await engine.acquire(transcriber, signal());
    let waited = false;
    const second = engine.acquire(transcriber, signal(), {
      onWaiting: () => {
        waited = true;
      },
    });
    expect(waited).toBe(true);
    expect(monitor.getPhase()).toBe('ready');
    first.release();
    (await second).release();
    expect(calls).toEqual([`start ${transcriber.id}`]);

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
    (await engine.acquire(corrector, signal())).release();
    expect(client.startModel).toHaveBeenCalledTimes(2);
  });

  it('abandons a switch that hangs when it is reset and serves the waiting requests afresh', async () => {
    const { client, calls, gates } = fakeRuntime();
    const engine = createLlmEngine(client);
    const hung = deferred<undefined>();
    gates[transcriber.id] = hung.promise;
    const page = new AbortController();
    const stuck = engine.acquire(transcriber, page.signal);
    await vi.waitFor(() => expect(calls).toEqual([`start ${transcriber.id}`]));

    let correctorGranted = false;
    const correction = engine.acquire(corrector, signal()).then((lease) => {
      correctorGranted = true;
      return lease;
    });
    page.abort();
    await expect(stuck).rejects.toBeInstanceOf(LlmCallError);
    await engine.reset(transcriber.id);
    const lease = await correction;
    expect(correctorGranted).toBe(true);
    expect(calls).toEqual([`start ${transcriber.id}`, 'stop', `start ${corrector.id}`]);

    delete gates[transcriber.id];
    const next = engine.acquire(transcriber, signal());
    hung.resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.monitor(corrector.id).getPhase()).toBe('ready');
    expect(calls).toHaveLength(3);
    lease.release();
    (await next).release();
    expect(calls).toEqual([
      `start ${transcriber.id}`,
      'stop',
      `start ${corrector.id}`,
      'stop',
      `start ${transcriber.id}`,
    ]);
    expect(engine.monitor(transcriber.id).getPhase()).toBe('ready');
  });

  it('does not stop a server that runs another model when a waiting caller resets', async () => {
    const { client, calls } = fakeRuntime();
    const engine = createLlmEngine(client);
    const correction = await engine.acquire(corrector, signal());
    const page = engine.acquire(transcriber, signal());
    await engine.reset(transcriber.id);
    expect(client.stop).not.toHaveBeenCalled();
    expect(engine.monitor(corrector.id).getPhase()).toBe('ready');
    correction.release();
    (await page).release();
    expect(calls).toEqual([`start ${corrector.id}`, 'stop', `start ${transcriber.id}`]);
  });

  it('reports waiting and starting separately and counts only the start as startup time', async () => {
    const { client } = fakeRuntime();
    let clock = 0;
    const started = client.startModel.getMockImplementation();
    client.startModel.mockImplementation(async (modelId) => {
      clock += 2500;
      return (await started?.(modelId)) ?? { state: 'stopped' };
    });
    const engine = createLlmEngine(client, () => clock);
    const correction = await engine.acquire(corrector, signal());
    const events: string[] = [];
    const page = engine.acquire(transcriber, signal(), {
      onWaiting: () => events.push('waiting'),
      onStarting: () => events.push('starting'),
    });
    clock += 60_000;
    correction.release();
    expect((await page).startupMs).toBe(2500);
    expect(events).toEqual(['waiting', 'starting']);
  });
});

function fakeClock() {
  const scheduled = new Set<{ callback: () => void; at: number }>();
  let now = 0;
  const timer: EngineTimer = (callback, ms) => {
    const entry = { callback, at: now + ms };
    scheduled.add(entry);
    return () => void scheduled.delete(entry);
  };
  return {
    timer,
    pending: () => scheduled.size,
    advance(ms: number) {
      now += ms;
      for (const entry of Array.from(scheduled)) {
        if (entry.at > now) continue;
        scheduled.delete(entry);
        entry.callback();
      }
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function setup() {
  const runtime = fakeRuntime();
  const clock = fakeClock();
  const gate = { open: () => undefined as void, wait: Promise.resolve() };
  const stopIfIdle = vi.fn<(idleMs: number) => Promise<boolean>>(async () => {
    await gate.wait;
    await runtime.client.stop();
    return true;
  });
  const client = { ...runtime.client, stopIfIdle };
  const engine = createLlmEngine(client, () => 0, clock.timer);
  const hold = () => {
    gate.wait = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
  };
  return { ...runtime, client, stopIfIdle, engine, clock, hold, gate };
}

describe('idle stop', () => {
  it('stops the sidecar after five idle minutes and reports the model as unloaded', async () => {
    const { engine, clock, stopIfIdle, calls } = setup();
    (await engine.acquire(transcriber, signal())).release();
    await settle();
    clock.advance(IDLE_STOP_MS - 1);
    expect(stopIfIdle).not.toHaveBeenCalled();
    clock.advance(1);
    await settle();
    expect(stopIfIdle).toHaveBeenCalledWith(IDLE_STOP_MS);
    expect(calls).toEqual([`start ${transcriber.id}`, 'stop']);
    expect(engine.loadedModel()).toBeNull();
    expect(engine.monitor(transcriber.id).getPhase()).toBe('idle');
    expect(clock.pending()).toBe(0);
  });

  it('starts the full five minutes again after every request', async () => {
    const { engine, clock, stopIfIdle } = setup();
    (await engine.acquire(transcriber, signal())).release();
    await settle();
    clock.advance(IDLE_STOP_MS - 1000);
    (await engine.acquire(transcriber, signal())).release();
    await settle();
    clock.advance(IDLE_STOP_MS - 1000);
    await settle();
    expect(stopIfIdle).not.toHaveBeenCalled();
    clock.advance(1000);
    await settle();
    expect(stopIfIdle).toHaveBeenCalledTimes(1);
  });

  it('never stops while a lease is held or a request is waiting', async () => {
    const { engine, clock, stopIfIdle } = setup();
    const lease = await engine.acquire(transcriber, signal());
    expect(clock.pending()).toBe(0);
    clock.advance(IDLE_STOP_MS * 3);
    await settle();
    expect(stopIfIdle).not.toHaveBeenCalled();
    const next = engine.acquire(transcriber, signal());
    lease.release();
    (await next).release();
    await settle();
    expect(clock.pending()).toBe(1);
  });

  it('starts the model again on the next request after an idle stop', async () => {
    const { engine, clock, calls } = setup();
    (await engine.acquire(transcriber, signal())).release();
    await settle();
    clock.advance(IDLE_STOP_MS);
    await settle();
    const lease = await engine.acquire(transcriber, signal());
    expect(calls).toEqual([`start ${transcriber.id}`, 'stop', `start ${transcriber.id}`]);
    expect(engine.monitor(transcriber.id).getPhase()).toBe('ready');
    lease.release();
    await settle();
    expect(clock.pending()).toBe(1);
  });

  it('serves a request that arrives while the idle stop is in flight, after the stop', async () => {
    const { engine, clock, calls, hold, gate } = setup();
    (await engine.acquire(transcriber, signal())).release();
    await settle();
    hold();
    clock.advance(IDLE_STOP_MS);
    await settle();
    const request = engine.acquire(transcriber, signal());
    await settle();
    expect(calls).toEqual([`start ${transcriber.id}`]);
    gate.open();
    const lease = await request;
    expect(calls).toEqual([`start ${transcriber.id}`, 'stop', `start ${transcriber.id}`]);
    expect(engine.monitor(transcriber.id).getPhase()).toBe('ready');
    lease.release();
  });

  it('keeps the model when the runtime reports it was busy', async () => {
    const { engine, clock, stopIfIdle, calls } = setup();
    stopIfIdle.mockResolvedValueOnce(false);
    (await engine.acquire(transcriber, signal())).release();
    await settle();
    clock.advance(IDLE_STOP_MS);
    await settle();
    expect(engine.loadedModel()).toBe(transcriber.id);
    expect(clock.pending()).toBe(1);
    (await engine.acquire(transcriber, signal())).release();
    await settle();
    expect(calls).toEqual([`start ${transcriber.id}`]);
  });

  it('cancels the timer on reset', async () => {
    const { engine, clock } = setup();
    (await engine.acquire(transcriber, signal())).release();
    await settle();
    expect(clock.pending()).toBe(1);
    await engine.reset();
    expect(clock.pending()).toBe(0);
  });
});
