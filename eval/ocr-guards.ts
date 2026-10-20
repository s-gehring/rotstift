import type { Mark } from '../src/annotations/transcript.ts';
import { markConfidence } from '../src/correction/reading-confidence.ts';

export type Verdict = 'keep' | 'uncertain' | 'drop';

export interface Guards {
  minConfidence?: number;
  isWord?: (word: string) => boolean;
}

export interface MarkContext {
  line: string;
  probabilities?: readonly number[] | undefined;
}

export function wordsOf(text: string): string[] {
  return text.match(/[\p{L}]+(?:['’-][\p{L}]+)*/gu) ?? [];
}

function knownWord(word: string, isWord: (word: string) => boolean): boolean {
  return isWord(word) || (word.includes('-') && word.split('-').every((part) => isWord(part)));
}

export function judgeMark(mark: Mark, context: MarkContext, guards: Guards): Verdict {
  const { isWord, minConfidence } = guards;
  if (isWord && wordsOf(mark.correction).some((word) => !knownWord(word, isWord))) return 'drop';
  if (minConfidence !== undefined && context.probabilities !== undefined) {
    if (markConfidence(context.line, context.probabilities, mark) < minConfidence) {
      return 'uncertain';
    }
  }
  return 'keep';
}
