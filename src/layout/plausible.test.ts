import { describe, expect, it } from 'vitest';
import { markImplausible } from './plausible.ts';
import { BLANK } from './ruling.ts';
import type { BBox, LineLocation, Ruling } from './types.ts';

const PITCH = 40;

const lined: Ruling = {
  ...BLANK,
  kind: 'lined',
  pitch: PITCH,
  horizontal: Array.from({ length: 12 }, (_, k) => ({
    points: [
      { x: 0, y: 100 + k * PITCH },
      { x: 800, y: 100 + k * PITCH },
    ],
  })),
};

function sitting(row: number, height = 30): LineLocation {
  const baseline = 100 + row * PITCH;
  return { bbox: { x: 50, y: baseline - height, width: 500, height }, confidence: 1 };
}

const inked = () => 0.12;

describe('markImplausible', () => {
  it('keeps lines that sit on the ruling', () => {
    const lines = [0, 1, 2, 3, 4, 5].map((row) => sitting(row));
    expect(markImplausible(lines, lined, inked)).toEqual(lines);
  });

  it('places a box spanning several rows roughly', () => {
    const lines = [sitting(0), sitting(1), sitting(2), sitting(3), sitting(8, 160)];
    const judged = markImplausible(lines, lined, inked);
    expect(judged.slice(0, 4)).toEqual(lines.slice(0, 4));
    expect(judged[4]).toEqual({ bbox: lines[4]?.bbox, confidence: 0, rough: true });
  });

  it('places a box over empty paper roughly', () => {
    const lines = [0, 1, 2, 3, 4].map((row) => sitting(row));
    const empty = lines[2]?.bbox;
    const judged = markImplausible(lines, lined, (box: BBox) => (box === empty ? 0.01 : 0.12));
    expect(judged[2]?.rough).toBe(true);
    expect(judged.filter((line) => line?.rough === true)).toHaveLength(1);
  });

  it('places a squashed box between two rules roughly', () => {
    const shifted: LineLocation = {
      bbox: { x: 50, y: 100 + 4 * PITCH - 10, width: 500, height: 18 },
      confidence: 1,
    };
    const lines = [sitting(0), sitting(1), sitting(2), sitting(3), shifted];
    expect(markImplausible(lines, lined, inked)[4]?.rough).toBe(true);
  });

  it('leaves a shifted box alone on blank paper', () => {
    const shifted: LineLocation = {
      bbox: { x: 50, y: 100 + 4 * PITCH - 10, width: 500, height: 18 },
      confidence: 1,
    };
    const lines = [sitting(0), sitting(1), sitting(2), sitting(3), shifted];
    expect(markImplausible(lines, BLANK, inked)[4]?.rough).toBeUndefined();
  });

  it('leaves a shifted box alone on grid paper', () => {
    const shifted: LineLocation = {
      bbox: { x: 50, y: 100 + 4 * PITCH - 10, width: 500, height: 18 },
      confidence: 1,
    };
    const lines = [sitting(0), sitting(1), sitting(2), sitting(3), shifted];
    const grid: Ruling = { ...lined, kind: 'grid', columnPitch: PITCH };
    expect(markImplausible(lines, grid, inked)[4]?.rough).toBeUndefined();
  });

  it('judges nothing with too few lines', () => {
    const lines = [sitting(0), sitting(5, 200), null];
    expect(markImplausible(lines, lined, inked)).toEqual(lines);
  });
});
