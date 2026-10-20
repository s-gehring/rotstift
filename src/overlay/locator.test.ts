import { describe, expect, it } from 'vitest';
import type { TranscriptLine } from '../annotations/transcript.ts';
import { proportionalLocator } from './locator.ts';

function line(text: string, bbox = { x: 100, y: 50, width: 400, height: 40 }): TranscriptLine {
  return { number: 1, bbox, text, marks: [] };
}

describe('proportionalLocator', () => {
  it('maps the whole text onto the bounding box', () => {
    const span = proportionalLocator.span(line('Hallo Welt'), 0, 10);
    expect(span.x0).toBeCloseTo(100);
    expect(span.x1).toBeCloseTo(500);
  });

  it('is monotonic and keeps spans inside the box', () => {
    const text = 'Wir sind früh losgefahren weil es regnete';
    const spans = [0, 5, 9, 14, text.length].map((end) =>
      proportionalLocator.span(line(text), 0, end),
    );
    const ends = spans.map((span) => span.x1);
    const sorted = Array.from(ends);
    sorted.sort((a, b) => a - b);
    expect(ends).toEqual(sorted);
    expect(new Set(ends).size).toBe(ends.length);
    expect(spans.at(-1)?.x1).toBeCloseTo(500);
  });

  it('gives wide letters more room than narrow ones', () => {
    const wide = proportionalLocator.span(line('mmmmiiii'), 0, 4);
    const narrow = proportionalLocator.span(line('mmmmiiii'), 4, 8);
    expect(wide.x1 - wide.x0).toBeGreaterThan((narrow.x1 - narrow.x0) * 2);
  });

  it('centres a position after a space in the gap between words', () => {
    const text = 'ein Haus';
    const word = proportionalLocator.span(line(text), 0, 3);
    const next = proportionalLocator.span(line(text), 4, 8);
    const gap = proportionalLocator.span(line(text), 4, 4);
    expect(gap.x0).toBeGreaterThan(word.x1);
    expect(gap.x0).toBeLessThan(next.x0);
    expect(gap.x0).toBe(gap.x1);
  });

  it('keeps a position directly behind a word at the word end', () => {
    const span = proportionalLocator.span(line('Hallo, Welt'), 5, 5);
    const word = proportionalLocator.span(line('Hallo, Welt'), 0, 5);
    expect(span.x0).toBeCloseTo(word.x1);
  });

  it('handles empty text and clamps offsets', () => {
    expect(proportionalLocator.span(line(''), 0, 0)).toEqual({ x0: 100, x1: 100 });
    const span = proportionalLocator.span(line('abc'), -3, 99);
    expect(span.x0).toBeCloseTo(100);
    expect(span.x1).toBeCloseTo(500);
  });

  it('requires a bounding box', () => {
    expect(() => proportionalLocator.span({ number: 1, text: 'abc', marks: [] }, 0, 1)).toThrow(
      'Bounding Box',
    );
  });
});
