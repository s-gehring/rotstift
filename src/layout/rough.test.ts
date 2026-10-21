import { describe, expect, it } from 'vitest';
import type { Assignment, Candidate } from './assign.ts';
import { placeRoughly } from './rough.ts';

function candidate(k: number): Candidate {
  return { x: 100, y: 100 + k * 60, width: 600, height: 40, inkCount: 1800, row: 120 + k * 60 };
}

function assignment(sources: (number[] | null)[]): Assignment {
  return {
    lines: sources.map((source) =>
      source === null ? null : { bbox: candidate(source[0] ?? 0), confidence: 0.9 },
    ),
    sources,
    tentative: sources.map(() => null),
    tentativeSources: sources.map(() => null),
  };
}

const candidates = [0, 1, 2, 3, 4].map(candidate);

describe('placeRoughly', () => {
  it('puts unassigned lines on the free detected lines between their neighbours', () => {
    const placed = placeRoughly(candidates, assignment([[0], null, null, [3], null]), [
      'a b c',
      'd e f',
      'g h i',
      'j k l',
      'm n o',
    ]);
    expect(placed.map((line) => line?.bbox.y)).toEqual([100, 160, 220, 280, 340]);
    expect(placed.map((line) => line?.rough)).toEqual([undefined, true, true, undefined, true]);
    expect(placed[1]?.confidence).toBe(0);
  });

  it('shares a free detected line and interpolates where none is left', () => {
    const shared = placeRoughly(candidates.slice(0, 3), assignment([[0], null, null, [2]]), [
      'aaaa',
      'bbbbbbbb',
      'cccccccc',
      'dddd',
    ]);
    expect(shared[1]?.bbox.x).toBe(100);
    expect(shared[2]?.bbox.x).toBe(400);
    const between = placeRoughly(candidates.slice(0, 2), assignment([[0], null, [1]]), [
      'a',
      'b',
      'c',
    ]);
    expect(between[1]?.bbox.y).toBe(130);
  });

  it('leaves blank lines and pages without any detected line alone', () => {
    expect(placeRoughly(candidates, assignment([[0], null]), ['a', ' '])[1]).toBeNull();
    expect(placeRoughly([], assignment([null]), ['a'])).toEqual([null]);
  });
});
