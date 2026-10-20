import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportPage } from '../import/pages.ts';
import type { DiagFields, PipelineDiagnostics } from './diagnostics.ts';
import { createRunner } from './runner.ts';
import type { PagePhase, PageTranscriber, TranscribeResult } from './transcriber.ts';
import { WATCHDOG } from './watchdog.ts';

const TRANSCRIPT = 'Gestern ging ich mit meinem Hund spazieren.';

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

type Behavior = 'ok' | 'hang' | 'hang-at-start' | 'lost' | 'crash' | { readonly duration: number };

function setup(script: Behavior[]) {
  const calls: string[] = [];
  const events: { event: string; fields: DiagFields }[] = [];
  const heartbeats: boolean[] = [];
  let recovered = 0;
  let index = 0;
  const transcriber: PageTranscriber = {
    transcribe: (_png, _signal, onPhase) => {
      const behavior = script[index] ?? 'ok';
      index += 1;
      calls.push(typeof behavior === 'string' ? behavior : 'timed');
      const phase = (name: PagePhase) => onPhase?.(name);
      if (behavior === 'hang-at-start') {
        phase('sidecar_start');
        return new Promise<TranscribeResult>(() => undefined);
      }
      phase('sidecar_start');
      phase('encoding');
      phase('request');
      if (behavior === 'hang') return new Promise<TranscribeResult>(() => undefined);
      if (behavior === 'crash') {
        return Promise.resolve<TranscribeResult>({
          ok: false,
          error: { kind: 'failed', message: 'x', crashed: true },
        });
      }
      if (behavior === 'lost') {
        return Promise.resolve<TranscribeResult>({ ok: false, error: { kind: 'cancelled' } });
      }
      const respond = (): TranscribeResult => {
        phase('parsing');
        return { ok: true, lines: [TRANSCRIPT] };
      };
      if (typeof behavior === 'object') {
        return new Promise<TranscribeResult>((resolve) =>
          setTimeout(() => {
            resolve(respond());
          }, behavior.duration),
        );
      }
      return Promise.resolve(respond());
    },
    recover: () => {
      recovered += 1;
      return Promise.resolve();
    },
  };
  const diagnostics: PipelineDiagnostics = {
    log: (event, fields = {}) => events.push({ event, fields }),
    heartbeat: (active) => heartbeats.push(active),
  };
  const runner = createRunner({
    render: (p) => Promise.resolve(new Blob([p.id])),
    now: () => performance.now(),
    diagnostics,
  });
  runner.setTranscriber(transcriber);
  return { runner, calls, events, heartbeats, recovered: () => recovered };
}

const status = (runner: ReturnType<typeof setup>['runner'], id: string) =>
  runner.getState().entries[id];

describe('runner watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a stuck page, retries it once and finishes it', async () => {
    const t = setup(['hang', 'ok']);
    t.runner.setPages([page('a')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(WATCHDOG.ceilingMs - 1);
    expect(status(t.runner, 'a')?.status).toBe('running');
    expect(t.calls).toEqual(['hang']);

    await vi.advanceTimersByTimeAsync(2);
    expect(t.calls).toEqual(['hang', 'ok']);
    expect(status(t.runner, 'a')).toMatchObject({ status: 'done', text: TRANSCRIPT });
    expect(t.runner.getState().batch).toBeNull();
    const names = t.events.map((entry) => entry.event);
    expect(names).toContain('page_stalled');
    expect(names).toContain('page_retry');
    expect(t.events.find((entry) => entry.event === 'page_stalled')?.fields).toMatchObject({
      phase: 'request',
      attempt: 1,
    });
    expect(t.recovered()).toBe(0);
  });

  it('ends a page that stalls twice with a German error and continues the batch', async () => {
    const t = setup(['hang', 'hang', 'ok']);
    t.runner.setPages([page('a'), page('b')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(WATCHDOG.ceilingMs * 2 + 10);

    const failed = status(t.runner, 'a');
    expect(failed?.status).toBe('error');
    expect(failed?.error).toMatchObject({ kind: 'failed' });
    expect(JSON.stringify(failed?.error)).toContain('hängen geblieben');
    expect(status(t.runner, 'b')).toMatchObject({ status: 'done', text: TRANSCRIPT });
    expect(t.runner.getState().batch).toBeNull();
    expect(t.recovered()).toBe(1);
    expect(t.events.map((entry) => entry.event)).toContain('page_failed');
  });

  it('retries a request that was cancelled from the outside', async () => {
    const t = setup(['lost', 'ok']);
    t.runner.setPages([page('a')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.calls).toEqual(['lost', 'ok']);
    expect(status(t.runner, 'a')?.status).toBe('done');
    expect(t.events.map((entry) => entry.event)).toContain('unexpected_cancel');
  });

  it('derives the limit from the median of finished pages', async () => {
    const t = setup([
      { duration: 100_000 },
      { duration: 100_000 },
      { duration: 100_000 },
      'hang',
      'ok',
    ]);
    t.runner.setPages([page('a'), page('b'), page('c'), page('d')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(300_000 + 10);
    expect(t.calls).toHaveLength(4);
    expect(t.runner.getState().durationsMs).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(400_000 - 100);
    expect(t.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.calls).toHaveLength(5);
    expect(status(t.runner, 'd')?.status).toBe('done');
  });

  it('never goes below the floor for quick pages', async () => {
    const t = setup([{ duration: 5000 }, { duration: 5000 }, { duration: 5000 }, 'hang', 'ok']);
    t.runner.setPages([page('a'), page('b'), page('c'), page('d')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(15_000 + WATCHDOG.floorMs - 100);
    expect(t.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(200);
    expect(t.calls).toHaveLength(5);
  });

  it('does not abort a healthy slow page and raises the limit afterwards', async () => {
    const slow: Behavior = { duration: 350_000 };
    const t = setup([slow, slow, slow, { duration: 500_000 }]);
    t.runner.setPages([page('a'), page('b'), page('c'), page('d')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(3 * 350_000 + 10);
    expect(t.calls).toEqual(['timed', 'timed', 'timed', 'timed']);
    expect(t.events.map((entry) => entry.event)).not.toContain('page_stalled');

    await vi.advanceTimersByTimeAsync(500_000);
    expect(status(t.runner, 'd')?.status).toBe('done');
    expect(t.events.map((entry) => entry.event)).not.toContain('page_stalled');
  });

  it('gives the second attempt the ceiling even when the first stalled early', async () => {
    const t = setup([
      { duration: 100_000 },
      { duration: 100_000 },
      { duration: 100_000 },
      'hang',
      { duration: 590_000 },
    ]);
    t.runner.setPages([page('a'), page('b'), page('c'), page('d')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(300_000 + 400_000 + 590_000 + 100);
    expect(status(t.runner, 'd')).toMatchObject({ status: 'done' });
    expect(t.events.filter((entry) => entry.event === 'page_stalled')).toHaveLength(1);
  });

  it('forgets observed durations when the transcriber is swapped', async () => {
    const t = setup([{ duration: 1000 }, { duration: 1000 }, { duration: 1000 }]);
    t.runner.setPages([page('a'), page('b'), page('c')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(t.runner.getState().durationsMs).toHaveLength(3);
    t.runner.setTranscriber({ transcribe: () => new Promise<TranscribeResult>(() => undefined) });
    expect(t.runner.getState().durationsMs).toEqual([]);
  });

  it('gives the sidecar startup its own, longer limit', async () => {
    const t = setup(['hang-at-start', 'ok']);
    t.runner.setPages([page('a')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(WATCHDOG.startupLimitMs - 10);
    expect(t.calls).toEqual(['hang-at-start']);
    await vi.advanceTimersByTimeAsync(20);
    expect(t.calls).toEqual(['hang-at-start', 'ok']);
    expect(t.recovered()).toBe(1);
  });

  it('names two outside cancellations differently from a hang', async () => {
    const t = setup(['lost', 'lost']);
    t.runner.setPages([page('a')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(10);
    const message = JSON.stringify(status(t.runner, 'a')?.error);
    expect(message).toContain('unerwartet abgebrochen');
    expect(message).not.toContain('hängen geblieben');
  });

  it('counts hangs and crashes together against the batch limit', async () => {
    const t = setup(['crash', 'hang', 'hang', 'ok']);
    t.runner.setPages([page('a'), page('b'), page('c')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(WATCHDOG.ceilingMs * 2 + 10);
    expect(status(t.runner, 'a')?.error).toMatchObject({ crashed: true });
    expect(status(t.runner, 'b')?.error).toMatchObject({ stalled: true });
    expect(status(t.runner, 'c')?.status).toBe('error');
    expect(JSON.stringify(status(t.runner, 'c')?.error)).toContain('mehrfach hängen geblieben');
    expect(t.calls).toHaveLength(3);
    expect(t.runner.getState().batch).toBeNull();
  });

  it('does not retry when the user cancels', async () => {
    const t = setup(['hang', 'ok']);
    t.runner.setPages([page('a')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(1000);
    t.runner.cancel();
    await vi.advanceTimersByTimeAsync(WATCHDOG.ceilingMs * 2);
    expect(t.calls).toEqual(['hang']);
    expect(t.events.map((entry) => entry.event)).not.toContain('page_stalled');
    expect(t.heartbeats.at(-1)).toBe(false);
  });

  it('sends heartbeats while a batch runs and one final one after it', async () => {
    const t = setup([{ duration: 12_000 }]);
    t.runner.setPages([page('a')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(13_000);
    expect(t.heartbeats.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(t.heartbeats.at(-1)).toBe(false);
  });

  it('reports phases and durations per page without any transcript or file name', async () => {
    const t = setup(['hang', { duration: 3000 }]);
    t.runner.setPages([page('a')]);
    t.runner.start();
    await vi.advanceTimersByTimeAsync(WATCHDOG.ceilingMs + 5000);
    expect(status(t.runner, 'a')?.status).toBe('done');
    const done = t.events.find((entry) => entry.event === 'page_done');
    expect(done?.fields).toMatchObject({ pageId: 'a', attempt: 2, ok: true });
    expect(done?.fields['requestMs']).toBe(3000);

    const serialized = JSON.stringify(t.events);
    expect(serialized).not.toContain(TRANSCRIPT);
    expect(serialized).not.toContain('Hund');
    expect(serialized).not.toContain('a.png');
  });
});
