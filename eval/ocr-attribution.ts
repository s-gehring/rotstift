import type { Mark } from '../src/annotations/transcript.ts';
import { tokenizeLines } from '../src/correction/tokens.ts';
import type { OriginalToken } from '../src/correction/tokens.ts';
import { linkWords } from './mark-metrics.ts';

export type Cause = 'reading' | 'corrector';

interface Located {
  token: OriginalToken;
  truth: number | undefined;
}

function overlaps(token: OriginalToken, line: number, start: number, end: number): boolean {
  return token.parts.some((part) => part.line === line && part.start < end && start < part.end);
}

function endsBefore(token: OriginalToken, line: number, offset: number): boolean {
  const last = token.parts.at(-1);
  return last !== undefined && (last.line < line || (last.line === line && last.end <= offset));
}

export interface Attribution {
  cause(line: number, mark: Mark): Cause;
  truthAround(line: number, mark: Mark): string[];
  readWords: number;
  misreadWords: number;
}

export function attributeMarks(truth: readonly string[], lines: readonly string[]): Attribution {
  const truthTokens = tokenizeLines(truth).flat();
  const readTokens = tokenizeLines(lines).flat();
  const links = linkWords(
    truthTokens.map((token) => token.text),
    readTokens.map((token) => token.text),
  );
  const truthOf = new Map<number, number>();
  links.forEach((read, index) => {
    if (read !== undefined) truthOf.set(read, index);
  });
  const located: Located[] = readTokens.map((token, index) => ({
    token,
    truth: truthOf.get(index),
  }));
  const words = located.filter(({ token }) => token.kind === 'word');

  function cause(line: number, mark: Mark): Cause {
    if (mark.kind === 'omission') {
      const before = located.findLast(({ token }) => endsBefore(token, line, mark.offset));
      const after = located.find(({ token }) => !endsBefore(token, line, mark.offset));
      if (before?.truth === undefined || after?.truth === undefined) return 'reading';
      return after.truth === before.truth + 1 ? 'corrector' : 'reading';
    }
    const covered = located.filter(({ token }) =>
      overlaps(token, line, mark.offset, mark.offset + mark.original.length),
    );
    if (covered.length === 0) return 'reading';
    const indices = covered.map((entry) => entry.truth);
    if (indices.some((index) => index === undefined)) return 'reading';
    const numbers = indices.filter((index) => index !== undefined);
    const contiguous = numbers.every((index, position) => index === (numbers[0] ?? 0) + position);
    return contiguous ? 'corrector' : 'reading';
  }

  function truthAround(line: number, mark: Mark): string[] {
    const end = mark.kind === 'omission' ? mark.offset : mark.offset + mark.original.length;
    const first = located.findIndex(({ token }) => !endsBefore(token, line, mark.offset));
    const firstAfter = located.findIndex(({ token }) => !endsBefore(token, line, end));
    const last = firstAfter === -1 ? located.length : firstAfter;
    const start = first === -1 ? located.length : first;
    const before = located.slice(0, start).findLast((entry) => entry.truth !== undefined);
    const after = located.slice(last).find((entry) => entry.truth !== undefined);
    const from = (before?.truth ?? -1) + 1;
    const to = after?.truth ?? truthTokens.length;
    return truthTokens.slice(from, to).map((token) => token.text);
  }

  return {
    cause,
    truthAround,
    readWords: words.length,
    misreadWords: words.filter((entry) => entry.truth === undefined).length,
  };
}
