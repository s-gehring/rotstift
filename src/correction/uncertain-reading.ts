import type { Mark, Transcript } from '../annotations/transcript.ts';
import { charProbabilities, lineProbabilities, markConfidence } from './reading-confidence.ts';
import type { TokenProbability } from './reading-confidence.ts';

export interface WordReading {
  readonly text: string;
  readonly confidence: number;
}

export interface PageReading {
  readonly words: readonly WordReading[];
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
): WordReading[] | null {
  const probabilities = charProbabilities(content, tokens);
  if (probabilities === null) return null;
  return lineProbabilities(content, probabilities, lines).flatMap((perChar, index) =>
    Array.from(lines[index]?.matchAll(WORD) ?? [], (match) => ({
      text: match[0],
      confidence: Math.min(1, ...perChar.slice(match.index, match.index + match[0].length)),
    })),
  );
}

export function wordProbabilities(
  lines: readonly string[],
  words: readonly WordReading[],
): number[][] {
  let cursor = 0;
  return lines.map((line) => {
    const result = Array.from(line, () => 1);
    for (const match of line.matchAll(WORD)) {
      const found = words.findIndex((word, index) => index >= cursor && word.text === match[0]);
      if (found === -1) continue;
      result.fill(words[found]?.confidence ?? 1, match.index, match.index + match[0].length);
      cursor = found + 1;
    }
    return result;
  });
}

export function separateUncertain(
  transcript: Transcript,
  reading: PageReading | null,
): SeparatedMarks {
  if (reading === null) return { transcript, hints: [] };
  const probabilities = wordProbabilities(
    transcript.lines.map((line) => line.text),
    reading.words,
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
