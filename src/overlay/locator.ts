import { charUnits } from './char-width.ts';
import type { TranscriptLine } from '../annotations/transcript.ts';

export interface XSpan {
  readonly x0: number;
  readonly x1: number;
}

export interface TextLocator {
  span(line: TranscriptLine, start: number, end: number): XSpan;
}

export const proportionalLocator: TextLocator = {
  span(line, start, end) {
    const bbox = line.bbox;
    if (bbox === undefined) throw new Error('Die Zeile hat keine Bounding Box.');
    const cumulative = cumulativeUnits(line.text);
    const total = cumulative[cumulative.length - 1] ?? 0;
    const from = clampIndex(start, line.text.length);
    const to = clampIndex(end, line.text.length);
    if (total === 0) return { x0: bbox.x, x1: bbox.x };
    const scale = bbox.width / total;
    let x0 = bbox.x + (cumulative[from] ?? 0) * scale;
    const x1 = bbox.x + (cumulative[to] ?? 0) * scale;
    if (from === to) {
      const gap = gapCenter(line.text, from, cumulative, scale);
      if (gap !== null) x0 = bbox.x + gap;
      return { x0, x1: x0 };
    }
    return { x0, x1 };
  },
};

function cumulativeUnits(text: string): number[] {
  const cumulative = [0];
  let total = 0;
  for (const char of text) {
    total += charUnits(char);
    for (let unit = 1; unit < char.length; unit += 1) cumulative.push(total);
    cumulative.push(total);
  }
  return cumulative;
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length);
}

function gapCenter(
  text: string,
  index: number,
  cumulative: readonly number[],
  scale: number,
): number | null {
  const before = text[index - 1];
  const after = text[index];
  if (before === undefined || after === undefined) return null;
  if (before !== ' ' || after === ' ') return null;
  const start = cumulative[index - 1] ?? 0;
  const end = cumulative[index] ?? 0;
  return ((start + end) / 2) * scale;
}
