import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportPage } from '../import/pages.ts';
import { createLlmEngine, type EngineClient } from '../llm/engine.ts';
import type { RuntimeStatus } from '../llm/types.ts';
import { defaultCorrector, recommendModel } from '../models/registry.ts';
import type { DiagFields, PipelineDiagnostics } from './diagnostics.ts';
import { createLlmTranscriber } from './llm-transcriber.ts';
import { createRunner } from './runner.ts';
import { WATCHDOG } from './watchdog.ts';

const transcriber = recommendModel();
const corrector = defaultCorrector();

const page: ImportPage = {
  id: 'a',
  fileKey: 'a',
  label: 'a.png',
  source: { kind: 'image', file: new File([], 'a.png') },
  width: 10,
  height: 10,
  rotation: 0,
  thumbnailUrl: 'blob:a',
};

function setup() {
  let status: RuntimeStatus = { state: 'stopped' };
  const client = {
    status: vi.fn<EngineClient['status']>(() => Promise.resolve(status)),
    startModel: vi.fn<EngineClient['startModel']>((modelId) => {
      const model =
        modelId === corrector.id ? corrector.files.model.name : transcriber.files.model.name;
      status = { state: 'ready', model, port: 1 };
      return Promise.resolve(status);
    }),
    stop: vi.fn<() => void>(() => {
      status = { state: 'stopped' };
    }),
    complete: vi.fn<EngineClient['complete']>(() =>
      Promise.resolve({ text: 'Heute scheint die Sonne.', finishReason: 'stop' }),
    ),
  };
  const engine = createLlmEngine(client);
  const events: { event: string; fields: DiagFields }[] = [];
  const diagnostics: PipelineDiagnostics = {
    log: (event, fields = {}) => events.push({ event, fields }),
    heartbeat: () => undefined,
  };
  const runner = createRunner({
    render: () => Promise.resolve(new Blob(['a'])),
    now: () => performance.now(),
    diagnostics,
  });
  runner.setTranscriber(
    createLlmTranscriber({
      client,
      engine,
      model: transcriber,
      encode: () => Promise.resolve('data:image/png;base64,AA=='),
    }),
  );
  return { runner, engine, client, events };
}

describe('runner with a shared engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for a long correction without counting it as a stalled start', async () => {
    const t = setup();
    const correction = await t.engine.acquire(corrector, new AbortController().signal);
    t.runner.setPages([page]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(WATCHDOG.startupLimitMs + 60_000);
    expect(t.runner.getState().entries['a']?.status).toBe('running');

    correction.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.runner.getState().entries['a']).toMatchObject({
      status: 'done',
      text: 'Heute scheint die Sonne.',
    });
    const names = t.events.map((entry) => entry.event);
    expect(names).not.toContain('page_stalled');
    expect(names).not.toContain('sidecar_recover');
    const phases = t.events
      .filter((entry) => entry.event === 'page_phase')
      .map((entry) => entry.fields['phase']);
    expect(phases).toEqual([
      'rendering',
      'queued',
      'sidecar_start',
      'encoding',
      'request',
      'parsing',
    ]);
    expect(t.events.find((entry) => entry.event === 'page_done')?.fields).toMatchObject({
      queueMs: expect.any(Number),
    });
    expect(t.client.stop).toHaveBeenCalledOnce();
  });
});
