import { describe, expect, it } from 'vitest';
import { formatRemaining } from './progress.ts';

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
