import { listErrors } from '../annotations/transcript.ts';
import type { Transcript } from '../annotations/transcript.ts';
import { countWords } from './count-words.ts';

export interface Statistics {
  words: number;
  errors: number;
  errorsByType: Record<string, number>;
  errorsPer100Words: number;
}

export function computeStatistics(transcript: Transcript): Statistics {
  const words = countWords(transcript.lines.map((line) => line.text).join('\n'));
  const errorsByType: Record<string, number> = {};
  const errors = listErrors(transcript);
  for (const error of errors) {
    errorsByType[error.type] = (errorsByType[error.type] ?? 0) + 1;
  }
  return {
    words,
    errors: errors.length,
    errorsByType,
    errorsPer100Words: words === 0 ? 0 : (errors.length / words) * 100,
  };
}
