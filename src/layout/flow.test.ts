import { describe, expect, it } from 'vitest';
import type { Assignment, Candidate } from './assign.ts';
import { joinPieces, type Flow } from './flow.ts';
import { item } from './signal.ts';
import type { LineLocation } from './types.ts';

function candidate(y: number): Candidate {
  return { x: 100, y, width: 600, height: 30, inkCount: 900, row: y + 15 };
}

const located = (box: Candidate): LineLocation => ({ bbox: box, confidence: 1 });

describe('joinPieces', () => {
  it('places a line roughly when another line took its only candidate', () => {
    const candidates = [candidate(100), candidate(150)];
    const flow: Flow = {
      texts: ['erste Zeile', 'zweite Zeile vorne', 'zweite Zeile hinten'],
      pieces: [
        { line: 0, from: 0, to: 1 },
        { line: 1, from: 0, to: 0.5 },
        { line: 1, from: 0.5, to: 1 },
      ],
      split: true,
    };
    const assignment: Assignment = {
      lines: [
        located(item(candidates, 0)),
        located(item(candidates, 0)),
        located(item(candidates, 1)),
      ],
      sources: [[0], [0], [1]],
      tentative: [null, null, null],
      tentativeSources: [null, null, null],
    };
    const lines = joinPieces(flow, assignment, assignment.lines, candidates, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.rough).toBe(true);
    expect(lines[0]?.bbox.y).toBe(100);
    expect(lines[1]?.bbox.y).toBe(100);
  });
});
