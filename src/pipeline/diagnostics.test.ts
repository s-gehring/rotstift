import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHeartbeat,
  HEARTBEAT_INTERVAL_MS,
  logLayout,
  readDiagnostics,
  tauriDiagnostics,
  type DiagInvoke,
  type PipelineDiagnostics,
} from './diagnostics.ts';

describe('tauriDiagnostics', () => {
  it('forwards events and heartbeats and swallows failures', () => {
    const invoke = vi.fn<DiagInvoke>(() => Promise.reject(new Error('gone')));
    const diagnostics = tauriDiagnostics(invoke);
    diagnostics.log('page_done', { pageId: 'abc', totalMs: 5 });
    diagnostics.heartbeat(true);
    expect(invoke).toHaveBeenCalledWith('diag_log', {
      event: 'page_done',
      fields: { pageId: 'abc', totalMs: 5 },
    });
    const anyBoolean: unknown = expect.any(Boolean);
    expect(invoke).toHaveBeenCalledWith('diag_heartbeat', {
      batchActive: true,
      visible: anyBoolean,
    });
  });

  it('survives an invoke that throws synchronously', () => {
    const diagnostics = tauriDiagnostics(() => {
      throw new Error('no tauri');
    });
    expect(() => {
      diagnostics.log('batch_start');
    }).not.toThrow();
  });
});

describe('readDiagnostics', () => {
  it('returns only string lines', async () => {
    const lines = await readDiagnostics(() => Promise.resolve(['a', 1, 'b']), 10);
    expect(lines).toEqual(['a', 'b']);
  });
});

describe('createHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('beats immediately and on an interval until stopped', async () => {
    const beats: boolean[] = [];
    const heart = createHeartbeat({ log: () => undefined, heartbeat: (a) => beats.push(a) });
    heart.start();
    heart.start();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
    expect(beats).toEqual([true, true, true]);
    heart.stop();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 3);
    expect(beats).toEqual([true, true, true, false]);
  });
});

describe('logLayout', () => {
  it('logs the line counts with a whole-millisecond duration, or the failure', () => {
    const log = vi.fn<PipelineDiagnostics['log']>();
    const diagnostics: PipelineDiagnostics = { log, heartbeat: () => undefined };
    const counts = { foundLines: 14, transcriptLines: 13, assignedLines: 12, roughLines: 1 };
    logLayout(diagnostics, { ...counts, durationMs: 212.6 });
    logLayout(diagnostics, null);
    expect(log.mock.calls).toEqual([
      ['page_layout', { ...counts, durationMs: 213 }],
      ['page_layout', { failed: true }],
    ]);
  });
});
