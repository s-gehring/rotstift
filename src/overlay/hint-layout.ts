import type { Mark, Transcript, TranscriptLine } from '../annotations/transcript.ts';
import type { HintStatus, ReadingHint } from '../correction/uncertain-reading.ts';
import { proportionalLocator, type TextLocator } from './locator.ts';

export interface HintSpot {
  readonly index: number;
  readonly status: HintStatus;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly underline: number;
  readonly mark: Mark;
}

const UNDERLINE = 0.92;
const MIN_WIDTH = 0.4;

export function markText(mark: Mark): string {
  if (mark.kind === 'omission') return `fehlt: „${mark.correction}“`;
  if (mark.correction === '') return `„${mark.original}“ streichen`;
  return `„${mark.original}“ → „${mark.correction}“`;
}

function wordRange(text: string, mark: Mark): [number, number] {
  const start = mark.offset;
  const end = mark.offset + mark.original.length;
  let from = start;
  let to = end;
  while (from > 0 && !/\s/u.test(text[from - 1] ?? ' ')) from -= 1;
  while (to < text.length && !/\s/u.test(text[to] ?? ' ')) to += 1;
  if (from === to && mark.kind === 'omission') {
    while (from > 0 && /\s/u.test(text[from - 1] ?? '')) from -= 1;
    while (from > 0 && !/\s/u.test(text[from - 1] ?? ' ')) from -= 1;
  }
  return [from, Math.max(to, from)];
}

export function layoutHints(
  transcript: Transcript,
  hints: readonly ReadingHint[],
  locator: TextLocator = proportionalLocator,
): HintSpot[] {
  const lines = new Map<number, TranscriptLine>(
    transcript.lines.map((line) => [line.number, line]),
  );
  return hints.flatMap((hint, index) => {
    const line = lines.get(hint.line);
    if (line?.bbox === undefined || hint.status === 'dismissed') return [];
    const [start, end] = wordRange(line.text, hint.mark);
    const span = locator.span(line, start, end);
    const { bbox } = line;
    const width = Math.max(span.x1 - span.x0, bbox.height * MIN_WIDTH);
    return [
      {
        index,
        status: hint.status,
        x: span.x0,
        y: bbox.y,
        width,
        height: bbox.height,
        underline: bbox.y + bbox.height * UNDERLINE,
        mark: hint.mark,
      },
    ];
  });
}
