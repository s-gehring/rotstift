import { listErrors } from '../annotations/transcript.ts';
import type { Transcript } from '../annotations/transcript.ts';
import { countWords } from './count-words.ts';

export interface Statistics {
  words: number;
  errors: number;
  errorsByType: Record<string, number>;
  errorsPer100Words: number;
}

export function continuesHyphenation(previousLine: string, line: string): boolean {
  return /\p{L}-$/u.test(previousLine) && /^\p{Ll}/u.test(line);
}

function joinLines(lines: string[]): string {
  const parts: string[] = [];
  for (const line of lines) {
    const previous = parts.at(-1);
    if (previous !== undefined && continuesHyphenation(previous, line)) {
      parts[parts.length - 1] = previous.slice(0, -1) + line;
    } else {
      parts.push(line);
    }
  }
  return parts.join('\n');
}

export function computeStatistics(transcript: Transcript): Statistics {
  const words = countWords(joinLines(transcript.lines.map((line) => line.text)));
  const counts = new Map<string, number>();
  const errors = listErrors(transcript);
  for (const error of errors) {
    counts.set(error.type, (counts.get(error.type) ?? 0) + 1);
  }
  return {
    words,
    errors: errors.length,
    errorsByType: Object.fromEntries(counts),
    errorsPer100Words: words === 0 ? 0 : (errors.length / words) * 100,
  };
}
