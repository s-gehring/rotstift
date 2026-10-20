import { describe, expect, it } from 'vitest';
import { median, pageLimitMs, phaseLimitMs, WATCHDOG } from './watchdog.ts';

describe('median', () => {
  it('handles empty, odd and even samples', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe('pageLimitMs', () => {
  it('starts at the ceiling until enough pages were observed', () => {
    expect(pageLimitMs([])).toBe(WATCHDOG.ceilingMs);
    expect(pageLimitMs([10_000, 12_000])).toBe(WATCHDOG.ceilingMs);
  });

  it('is the median times the factor, never below the floor', () => {
    expect(pageLimitMs([5_000, 6_000, 7_000])).toBe(WATCHDOG.floorMs);
    expect(pageLimitMs([100_000, 110_000, 120_000])).toBe(440_000);
  });

  it('is capped by the ceiling and ignores outliers', () => {
    expect(pageLimitMs([200_000, 210_000, 220_000])).toBe(WATCHDOG.ceilingMs);
    expect(pageLimitMs([80_000, 82_000, 84_000, 900_000, 1_000])).toBe(328_000);
  });

  it('stays below the 900 s timeout of the Rust side', () => {
    expect(WATCHDOG.ceilingMs).toBeLessThan(900_000);
  });
});

describe('phaseLimitMs', () => {
  it('judges the sidecar startup separately from page work', () => {
    const fast = [5_000, 5_000, 5_000];
    expect(phaseLimitMs('sidecar_start', fast)).toBe(WATCHDOG.startupLimitMs);
    expect(phaseLimitMs('request', fast)).toBe(WATCHDOG.floorMs);
  });

  it('always allows the ceiling on a second attempt', () => {
    expect(phaseLimitMs('request', [5_000, 5_000, 5_000], 2)).toBe(WATCHDOG.ceilingMs);
    expect(phaseLimitMs('sidecar_start', [], 2)).toBe(WATCHDOG.startupLimitMs);
  });
});
