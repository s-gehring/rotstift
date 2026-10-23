import { taskWords } from './first-names.ts';
import { buildSearchText, toSpans } from './search-text.ts';
import type { Detector, IdentifierSpan } from './types.ts';

export type UnknownWords = (
  words: readonly string[],
  signal: AbortSignal,
) => Promise<ReadonlySet<string>>;

const WORD = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’]*/gu;

export function wordForms(word: string): string[] {
  const bare = word.replace(/['’]s?$/u, '');
  const lower = bare.toLocaleLowerCase('de');
  const forms = [bare, lower, bare.charAt(0) + lower.slice(1)];
  if (bare.endsWith('s')) forms.push(bare.slice(0, -1));
  return [...new Set(forms)];
}

interface Candidate {
  readonly start: number;
  readonly word: string;
}

function candidates(text: string, task: string | undefined): Candidate[] {
  const fromTask = taskWords(task);
  const plainTask = new Set(
    (task ?? '').split(/[^\p{L}]+/u).map((word) => word.toLocaleLowerCase('de')),
  );
  return [...text.matchAll(WORD)].flatMap((match) => {
    const word = match[0];
    const plain = word.replace(/['’]s?$/u, '').toLocaleLowerCase('de');
    if (word.length < 3 || fromTask.has(plain) || plainTask.has(plain)) return [];
    return [{ start: match.index, word }];
  });
}

export async function findUnknownWordSpans(
  lines: readonly string[],
  task: string | undefined,
  unknownWords: UnknownWords,
  signal: AbortSignal,
): Promise<IdentifierSpan[]> {
  const search = buildSearchText(lines);
  const found = candidates(search.text, task);
  if (found.length === 0) return [];
  const forms = [...new Set(found.flatMap(({ word }) => wordForms(word)))];
  const unknown = await unknownWords(forms, signal);
  return found
    .filter(({ word }) => wordForms(word).every((form) => unknown.has(form)))
    .flatMap(({ start, word }) =>
      toSpans(search, { start, end: start + word.length, category: 'person' }, 'rule'),
    );
}

export function createDictionaryDetector(unknownWords: UnknownWords): Detector {
  return async (lines, context, signal) => {
    signal.throwIfAborted();
    return findUnknownWordSpans(lines, context.task, unknownWords, signal);
  };
}
