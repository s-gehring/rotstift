import { describe, expect, it } from 'vitest';
import { createRandom, seedFor } from './random.ts';
import { caret, clampPath, hand, ring, smoothPath } from './strokes.ts';

describe('strokes', () => {
  it('draws the same hand-drawn line for the same seed', () => {
    const first = hand(10, 200, 50, createRandom(seedFor(1, 2, 3)), 1);
    const second = hand(10, 200, 50, createRandom(seedFor(1, 2, 3)), 1);
    const other = hand(10, 200, 50, createRandom(seedFor(1, 2, 4)), 1);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });

  it('keeps a hand-drawn line near its baseline and between its ends', () => {
    const d = hand(10, 300, 80, createRandom(5), 1);
    const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(330);
    expect(Math.min(...ys)).toBeGreaterThan(70);
    expect(Math.max(...ys)).toBeLessThan(90);
  });

  it('draws a ring that overshoots its start', () => {
    const d = ring(100, 100, 40, 20, createRandom(9), 0.5);
    expect(d.startsWith('M')).toBe(true);
    expect(d.match(/C/g)?.length).toBe(14);
  });

  it('draws a caret as an inverted V', () => {
    const d = caret(100, 50, 8, 12, createRandom(2), 0);
    expect(d).toBe('M92 62L100 50L108 62');
  });

  it('handles degenerate inputs', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 1, y: 2 }])).toBe('M1 2');
    expect(
      smoothPath([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]),
    ).toBe('M1 2L3 4');
  });

  it('clamps every point, including control points, to the bounds', () => {
    expect(clampPath('M-5 3C120 -4 8.5 9 300.2 50', 0, 1, 100, 40)).toBe('M0 3C100 1 8.5 9 100 40');
  });
});
