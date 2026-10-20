import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportPage } from '../import/pages.ts';
import type { PipelineDiagnostics } from './diagnostics.ts';
import { createRunner } from './runner.ts';
import type { PageTranscriber, TranscribeResult } from './transcriber.ts';
import { WATCHDOG } from './watchdog.ts';

function page(id: string): ImportPage {
  return {
    id,
    fileKey: id,
    label: `${id}.png`,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 10,
    height: 10,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

function setup() {
  const heartbeats: boolean[] = [];
  const signals: AbortSignal[] = [];
  const diagnostics: PipelineDiagnostics = {
    log: () => undefined,
    heartbeat: (active) => heartbeats.push(active),
  };
  const transcriber: PageTranscriber = {
    transcribe: (_png, signal, onPhase) => {
      signals.push(signal);
      onPhase?.('request');
      return new Promise<TranscribeResult>(() => undefined);
    },
  };
  const runner = createRunner({
    render: (p) => Promise.resolve(new Blob([p.id])),
    diagnostics,
  });
  runner.setTranscriber(transcriber);
  runner.setPages([page('a'), page('b')]);
  return { runner, heartbeats, signals };
}

describe('runner.dispose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts the running page and stops watchdog and heartbeat timers', async () => {
    const t = setup();
    t.runner.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.signals).toHaveLength(1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    t.runner.dispose();
    await vi.advanceTimersByTimeAsync(0);

    expect(t.signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(t.heartbeats.at(-1)).toBe(false);
  });

  it('changes no state and calls no listener after dispose', async () => {
    const t = setup();
    const listener = vi.fn<() => void>();
    t.runner.subscribe(listener);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(10);
    const before = t.runner.getState();
    listener.mockClear();

    t.runner.dispose();
    await vi.advanceTimersByTimeAsync(WATCHDOG.ceilingMs * 3);
    t.runner.cancel();
    t.runner.setPages([page('a')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(WATCHDOG.ceilingMs);

    expect(listener).not.toHaveBeenCalled();
    expect(t.runner.getState()).toBe(before);
    expect(t.signals).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is idempotent and harmless before anything ran', () => {
    const runner = createRunner({
      render: () => Promise.resolve(new Blob()),
      diagnostics: { log: () => undefined, heartbeat: () => undefined },
    });
    runner.dispose();
    runner.dispose();
    runner.setPages([page('a')]);
    runner.start();
    expect(runner.getState().batch).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
