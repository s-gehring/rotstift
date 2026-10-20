import { describe, expect, it } from 'vitest';
import { assignLines, lineLength, type Candidate } from './assign.ts';

const CHAR = 10;

function candidate(chars: number, top: number, height = 40): Candidate {
  return {
    x: 100,
    y: top,
    width: chars * CHAR,
    height,
    inkCount: chars * 30,
    row: top + height / 2,
  };
}

function stack(
  chars: readonly number[],
  blanksBefore: Readonly<Record<number, number>>,
): Candidate[] {
  let top = 100;
  return chars.map((count, k) => {
    top += 60 * (blanksBefore[k] ?? 0);
    const line = candidate(count, top);
    top += 60;
    return line;
  });
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
    const chars = [30, 42, 25, 38, 33, 41, 29, 36];
    const detected = stack(chars, { 2: 1 });
    const transcript = chars.flatMap((count, k) =>
      k === 2 ? ['', sentence(count)] : [sentence(count)],
    );
    const result = assignLines(detected, transcript);
    expect(result[2]).toBeNull();
    expect(result.map((line) => line?.bbox.y ?? null)).toEqual([
      100,
      160,
      null,
      280,
      340,
      400,
      460,
      520,
      580,
    ]);
  });

  it('skips a detected stray mark that has little ink', () => {
    const chars = [30, 42, 25, 38, 33, 41, 29, 36];
    const detected = stack(chars, {});
    detected.splice(3, 0, candidate(3, 190, 20));
    const result = assignLines(
      detected,
      chars.map((count) => sentence(count)),
    );
    expect(result.map((line) => line?.bbox.y)).toEqual([100, 160, 220, 280, 340, 400, 460, 520]);
  });

  it('returns null for a transcript line without any detected line', () => {
    const chars = [30, 40, 35, 28, 44, 37, 32, 41, 27, 39];
    const detected = stack(chars, {});
    const result = assignLines(detected, [...chars.map((count) => sentence(count)), sentence(90)]);
    expect(result[10]).toBeNull();
    const wrong = result
      .slice(0, 10)
      .filter((line, k) => line !== null && line.bbox.y !== 100 + 60 * k);
    expect(wrong).toHaveLength(0);
    expect(result.filter((line) => line !== null).length).toBeGreaterThanOrEqual(8);
  });

  it('merges two detected pieces of one line into one box', () => {
    const chars = [36, 40, 33, 45, 38, 31, 42, 35, 39, 44];
    const detected = stack(chars, {});
    const pieces: Candidate[] = [
      { x: 100, y: 100, width: 300, height: 40, inkCount: 900, row: 120 },
      { x: 420, y: 104, width: 300, height: 38, inkCount: 800, row: 123 },
    ];
    detected.splice(0, 1, ...pieces);
    const result = assignLines(
      detected,
      [60, ...chars.slice(1)].map((count) => sentence(count)),
    );
    expect(result[0]?.bbox).toEqual({ x: 100, y: 100, width: 620, height: 42 });
    expect(result[1]?.bbox.y).toBe(160);
  });

  it('splits a wide detected line horizontally when the transcript has two lines', () => {
    const chars = [36, 40, 60, 38, 41, 35, 39, 43, 34, 37];
    const detected = stack(chars, {});
    const transcript = [36, 40, 20, 40, 38, 41, 35, 39, 43, 34, 37].map((count) => sentence(count));
    const result = assignLines(detected, transcript);
    const first = result[2];
    const second = result[3];
    expect(first?.bbox).toEqual({ x: 100, y: 220, width: 200, height: 40 });
    expect(second?.bbox.x).toBeCloseTo(300, 5);
    expect(second?.bbox.width).toBeCloseTo(400, 5);
    expect(first?.confidence).toBeLessThan(result[0]?.confidence ?? 0);
  });

  it('splits a tall detected band vertically when the transcript has two lines', () => {
    const chars = [40, 41, 39, 40, 38, 42, 37, 41, 36, 40];
    const detected = stack(chars, {});
    detected.splice(2, 1, candidate(39, 200, 100));
    detected.forEach((line, k) => {
      if (k > 2) detected[k] = { ...line, y: line.y + 40, row: line.row + 40 };
    });
    const transcript = [40, 41, 20, 19, 40, 38, 42, 37, 41, 36, 40].map((count) => sentence(count));
    const result = assignLines(detected, transcript);
    expect(result[2]?.bbox.y).toBeCloseTo(200, 5);
    expect(result[2]?.bbox.height).toBeGreaterThan(45);
    expect(result[3]?.bbox.y).toBeGreaterThan(240);
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
    const doubtful = result[3];
    expect(confident).toBeGreaterThan(0.9);
    expect(doubtful).not.toBeNull();
    expect(doubtful?.confidence ?? 1).toBeLessThan(0.75);
  });
});
