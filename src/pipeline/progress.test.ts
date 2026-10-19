import { describe, expect, it } from 'vitest';
import { describeProgress, formatRemaining } from './progress.ts';
import type { RunState } from './runner.ts';

function state(
  batch: RunState['batch'],
  durationsMs: number[] = [],
  runningSince: number | null = null,
): RunState {
  return { entries: {}, batch, durationsMs, runningSince };
}

describe('describeProgress', () => {
  it('is null outside a run', () => {
    expect(describeProgress(state(null), 0)).toBeNull();
  });

  it('counts the page in progress and has no estimate before the first page', () => {
    expect(describeProgress(state({ total: 4, finished: 0 }), 0)).toEqual({
      current: 1,
      total: 4,
      remainingMs: null,
    });
  });

  it('estimates the rest from the average of the finished pages', () => {
    expect(describeProgress(state({ total: 5, finished: 2 }, [10_000, 20_000]), 0)).toEqual({
      current: 3,
      total: 5,
      remainingMs: 45_000,
    });
  });

  it('subtracts the time the current page has already taken', () => {
    const progress = describeProgress(state({ total: 3, finished: 0 }, [10_000], 100_000), 106_000);
    expect(progress?.remainingMs).toBe(24_000);
  });

  it('keeps the remaining pages as lower bound when the current page runs long', () => {
    const progress = describeProgress(state({ total: 3, finished: 0 }, [10_000], 0), 50_000);
    expect(progress?.remainingMs).toBe(20_000);
  });

  it('never shows a page beyond the total', () => {
    expect(describeProgress(state({ total: 2, finished: 2 }, [1000]), 0)?.current).toBe(2);
  });
});

describe('formatRemaining', () => {
  it.each([
    [3_000, 'weniger als 10 Sekunden'],
    [42_000, 'etwa 40 Sekunden'],
    [60_000, 'etwa 1 Minute'],
    [61_000, 'etwa 2 Minuten'],
    [10 * 60_000, 'etwa 10 Minuten'],
    [100 * 60_000, 'etwa 1 Std. 40 Min.'],
  ])('formats %i ms', (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });
});
