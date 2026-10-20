import type { Mark, Transcript } from '../annotations/transcript.ts';
import { charProbabilities, lineProbabilities, markConfidence } from './reading-confidence.ts';
import type { TokenProbability } from './reading-confidence.ts';

export interface WordReading {
  readonly text: string;
  readonly confidence: number;
}

export interface PageReading {
  readonly lines: readonly (readonly WordReading[])[];
  readonly uncertainBelow: number;
}

export type HintStatus = 'open' | 'accepted' | 'dismissed';

export interface ReadingHint {
  readonly line: number;
  readonly mark: Mark;
  readonly confidence: number;
  readonly status: HintStatus;
}

export interface SeparatedMarks {
  readonly transcript: Transcript;
  readonly hints: readonly ReadingHint[];
}

const WORD = /\S+/gu;

export function readWords(
  content: string,
  tokens: readonly TokenProbability[],
  lines: readonly string[],
): WordReading[][] | null {
  const probabilities = charProbabilities(content, tokens);
  if (probabilities === null) return null;
  return lineProbabilities(content, probabilities, lines).map((perChar, index) =>
    Array.from(lines[index]?.matchAll(WORD) ?? [], (match) => ({
      text: match[0],
      confidence: Math.min(1, ...perChar.slice(match.index, match.index + match[0].length)),
    })),
  );
}

export function editReading(
  reading: PageReading | null,
  before: readonly string[],
  after: readonly string[],
): PageReading | null {
  if (reading === null || before.length !== after.length) return null;
  return {
    ...reading,
    lines: reading.lines.map((words, index) => (before[index] === after[index] ? words : [])),
  };
}

export function wordProbabilities(
  lines: readonly string[],
  readings: readonly (readonly WordReading[])[],
): number[][] {
  return lines.map((line, index) => {
    const result = Array.from(line, () => 1);
    const words = [...line.matchAll(WORD)];
    const read = readings[index] ?? [];
    const same =
      words.length === read.length && words.every((match, at) => match[0] === read[at]?.text);
    if (!same) return result;
    words.forEach((match, at) => {
      result.fill(read[at]?.confidence ?? 1, match.index, match.index + match[0].length);
    });
    return result;
  });
}

export function separateUncertain(
  transcript: Transcript,
  reading: PageReading | null,
): SeparatedMarks {
  if (reading === null || reading.lines.length !== transcript.lines.length) {
    return { transcript, hints: [] };
  }
  const probabilities = wordProbabilities(
    transcript.lines.map((line) => line.text),
    reading.lines,
  );
  const hints: ReadingHint[] = [];
  const lines = transcript.lines.map((line, index) => {
    const perChar = probabilities[index] ?? [];
    const marks = line.marks.filter((mark) => {
      const confidence = markConfidence(line.text, perChar, mark);
      if (confidence >= reading.uncertainBelow) return true;
      hints.push({ line: line.number, mark, confidence, status: 'open' });
      return false;
    });
    return marks.length === line.marks.length ? line : { ...line, marks };
  });
  return { transcript: { lines }, hints };
}

function byPosition(a: Mark, b: Mark): number {
  return a.offset - b.offset || a.original.length - b.original.length;
}

export function withAcceptedHints(base: Transcript, hints: readonly ReadingHint[]): Transcript {
  const accepted = hints.filter((hint) => hint.status === 'accepted');
  if (accepted.length === 0) return base;
  return {
    lines: base.lines.map((line) => {
      const added = accepted.filter((hint) => hint.line === line.number).map((hint) => hint.mark);
      return added.length === 0
        ? line
        : { ...line, marks: [...line.marks, ...added].toSorted(byPosition) };
    }),
  };
}

const NEXT_STATUS: Readonly<Record<HintStatus, HintStatus>> = {
  open: 'accepted',
  accepted: 'dismissed',
  dismissed: 'open',
};

export function nextHintStatus(status: HintStatus): HintStatus {
  return NEXT_STATUS[status];
}

export function openHints(hints: readonly ReadingHint[]): number {
  return hints.filter((hint) => hint.status === 'open').length;
}
