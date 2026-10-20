import { describe, expect, it } from 'vitest';
import { assignLines, lineLength, type Candidate } from './assign.ts';

const CHAR = 10;

function candidate(chars: number, top: number, height = 40): Candidate {
  return { x: 100, y: top, width: chars * CHAR, height, inkCount: chars * 30 };
}

function sentence(chars: number): string {
  return 'x'.repeat(chars);
}

describe('lineLength', () => {
  it('counts characters without surrounding or repeated whitespace', () => {
    expect(lineLength('  Hallo   Welt ')).toBe(10);
    expect(lineLength('   ')).toBe(0);
    expect(lineLength('äöü')).toBe(3);
  });
});

describe('assignLines', () => {
  it('maps lines one to one in reading order', () => {
    const detected = [
      candidate(30, 100),
      candidate(42, 160),
      candidate(25, 220),
      candidate(38, 280),
    ];
    const result = assignLines(detected, [sentence(30), sentence(42), sentence(25), sentence(38)]);
    expect(result.map((line) => line?.bbox.y)).toEqual([100, 160, 220, 280]);
    expect(result.every((line) => (line?.confidence ?? 0) > 0.9)).toBe(true);
  });

  it('returns null for blank transcript lines and keeps the others aligned', () => {
    const detected = [candidate(30, 100), candidate(42, 160), candidate(25, 220)];
    const result = assignLines(detected, [sentence(30), '', sentence(42), '  ', sentence(25)]);
    expect(result.map((line) => line?.bbox.y ?? null)).toEqual([100, null, 160, null, 220]);
  });

  it('skips a detected stray mark that has little ink', () => {
    const detected = [
      candidate(30, 100),
      candidate(3, 150, 20),
      candidate(42, 200),
      candidate(25, 260),
    ];
    const result = assignLines(detected, [sentence(30), sentence(42), sentence(25)]);
    expect(result.map((line) => line?.bbox.y)).toEqual([100, 200, 260]);
  });

  it('returns null for a transcript line without any detected line', () => {
    const detected = [candidate(30, 100), candidate(40, 160)];
    const result = assignLines(detected, [sentence(30), sentence(40), sentence(60)]);
    expect(result.map((line) => line?.bbox.y ?? null)).toEqual([100, 160, null]);
  });

  it('merges two detected pieces of one line into one box', () => {
    const left: Candidate = { x: 100, y: 100, width: 200, height: 40, inkCount: 900 };
    const right: Candidate = { x: 340, y: 104, width: 180, height: 38, inkCount: 800 };
    const next = candidate(40, 160);
    const result = assignLines(
      [left, right, next, candidate(36, 220)],
      [sentence(42), sentence(40), sentence(36)],
    );
    expect(result[0]?.bbox).toEqual({ x: 100, y: 100, width: 420, height: 42 });
    expect(result[1]?.bbox.y).toBe(160);
  });

  it('splits a wide detected line horizontally when the transcript has two lines', () => {
    const detected = [
      candidate(36, 100),
      candidate(40, 160),
      candidate(60, 220),
      candidate(38, 280),
      candidate(41, 340),
    ];
    const result = assignLines(detected, [
      sentence(36),
      sentence(40),
      sentence(20),
      sentence(40),
      sentence(38),
      sentence(41),
    ]);
    const first = result[2];
    const second = result[3];
    expect(first?.bbox).toEqual({ x: 100, y: 220, width: 200, height: 40 });
    expect(second?.bbox.x).toBeCloseTo(300, 5);
    expect(second?.bbox.width).toBeCloseTo(400, 5);
    expect(first?.confidence).toBeLessThan(result[0]?.confidence ?? 0);
  });

  it('splits a tall detected band vertically when the transcript has two lines', () => {
    const detected = [
      candidate(40, 100),
      candidate(41, 160),
      candidate(39, 220, 100),
      candidate(40, 340),
    ];
    const result = assignLines(detected, [
      sentence(40),
      sentence(41),
      sentence(20),
      sentence(19),
      sentence(40),
    ]);
    expect(result[2]?.bbox.y).toBeCloseTo(220, 5);
    expect(result[2]?.bbox.height).toBeGreaterThan(45);
    expect(result[3]?.bbox.y).toBeGreaterThan(260);
    expect(result[3]?.bbox.width).toBe(390);
  });

  it('returns only nulls without detected lines or without text', () => {
    expect(assignLines([], ['abc', 'def'])).toEqual([null, null]);
    expect(assignLines([candidate(10, 10)], ['', ' '])).toEqual([null, null]);
    expect(assignLines([candidate(10, 10)], [])).toEqual([]);
  });

  it('gives a lower confidence when the ink width does not match the text', () => {
    const detected = [
      candidate(30, 100),
      candidate(40, 160),
      candidate(35, 220),
      candidate(30, 280),
    ];
    const result = assignLines(detected, [sentence(30), sentence(40), sentence(35), sentence(70)]);
    const confident = result[0]?.confidence ?? 0;
    const doubtful = result[3]?.confidence ?? 0;
    expect(confident).toBeGreaterThan(0.9);
    expect(doubtful === 0 || doubtful < confident).toBe(true);
  });
});
