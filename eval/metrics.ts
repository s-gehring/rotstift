import type { ErrorKind, Sample } from './sample.ts';

const CHARACTER_FOLDS: [RegExp, string][] = [
  [/[„“”«»]/g, '"'],
  [/[‚‘’‹›]/g, "'"],
  [/[–—]/g, '-'],
];

function foldCharacters(text: string): string {
  let folded = text.normalize('NFC');
  for (const [pattern, replacement] of CHARACTER_FOLDS)
    folded = folded.replace(pattern, replacement);
  return folded;
}

export function cleanTranscript(output: string): string {
  return output
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
    .replace(/^```[^\n]*\n?|\n?```$/g, '')
    .trim();
}

export function normalize(text: string): string {
  return foldCharacters(text).replace(/\s+/g, ' ').trim();
}

export function editDistance<T>(reference: readonly T[], hypothesis: readonly T[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j++) {
      const substitution =
        (previous[j - 1] ?? 0) + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      current.push(Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1));
    }
    previous = current;
  }
  return previous[hypothesis.length] ?? 0;
}

export interface EditCount {
  edits: number;
  total: number;
}

export function characterEdits(reference: string, hypothesis: string): EditCount {
  const ref = Array.from(normalize(reference));
  return { edits: editDistance(ref, Array.from(normalize(hypothesis))), total: ref.length };
}

export function wordEdits(reference: string, hypothesis: string): EditCount {
  const ref = words(reference);
  return { edits: editDistance(ref, words(hypothesis)), total: ref.length };
}

export function rate({ edits, total }: EditCount): number {
  return edits / Math.max(total, 1);
}

function words(text: string): string[] {
  const normalized = normalize(text);
  return normalized === '' ? [] : normalized.split(' ');
}

export function alignWords(
  reference: readonly string[],
  hypothesis: readonly string[],
): string[][] {
  const rows = reference.length + 1;
  const columns = hypothesis.length + 1;
  const cost = new Uint32Array(rows * columns);
  for (let j = 0; j < columns; j++) cost[j] = j;
  for (let i = 1; i < rows; i++) {
    cost[i * columns] = i;
    for (let j = 1; j < columns; j++) {
      const same = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      cost[i * columns + j] = Math.min(
        (cost[(i - 1) * columns + j - 1] ?? 0) + same,
        (cost[(i - 1) * columns + j] ?? 0) + 1,
        (cost[i * columns + j - 1] ?? 0) + 1,
      );
    }
  }

  const aligned: string[][] = reference.map(() => []);
  let i = reference.length;
  let j = hypothesis.length;
  let pendingInsertions: string[] = [];
  while (i > 0 || j > 0) {
    const here = cost[i * columns + j] ?? 0;
    const diagonal = i > 0 && j > 0 ? (cost[(i - 1) * columns + j - 1] ?? 0) : Infinity;
    const match = i > 0 && j > 0 && reference[i - 1] === hypothesis[j - 1];
    const deletion = i > 0 && here === (cost[(i - 1) * columns + j] ?? 0) + 1;
    if ((match && here === diagonal) || (!deletion && here === diagonal + 1)) {
      aligned[i - 1] = [hypothesis[j - 1] ?? '', ...pendingInsertions];
      pendingInsertions = [];
      i--;
      j--;
    } else if (deletion) {
      aligned[i - 1] = pendingInsertions;
      pendingInsertions = [];
      i--;
    } else {
      pendingInsertions = [hypothesis[j - 1] ?? '', ...pendingInsertions];
      j--;
    }
  }
  if (pendingInsertions.length > 0 && aligned[0])
    aligned[0] = [...pendingInsertions, ...aligned[0]];
  return aligned;
}

export type ErrorOutcome = 'preserved' | 'corrected' | 'misread';

export interface ErrorResult {
  kind: ErrorKind;
  written: string;
  correct: string;
  transcribed: string;
  outcome: ErrorOutcome;
}

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  return [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function classifyErrors(sample: Sample, hypothesis: string): ErrorResult[] {
  const reference = foldCharacters(sample.written);
  const tokens = tokenize(reference);
  const aligned = alignWords(
    tokens.map((token) => token.text),
    words(hypothesis),
  );

  return sample.errors.map((error) => {
    const from = error.start === error.end ? error.start - 1 : error.start;
    const covered = tokens
      .map((token, index) => ({ token, index }))
      .filter(({ token }) => token.start < Math.max(error.end, from + 1) && token.end > from);
    const first = covered[0];
    const last = covered.at(-1);
    if (!first || !last) throw new Error(`Error "${error.written}" is not inside any word`);

    const window = reference.slice(first.token.start, last.token.end);
    const offset = first.token.start;
    const correctedWindow =
      window.slice(0, error.start - offset) +
      foldCharacters(error.correct) +
      window.slice(error.end - offset);
    const transcribed = covered.flatMap(({ index }) => aligned[index] ?? []).join(' ');

    let outcome: ErrorOutcome = 'misread';
    if (transcribed === normalize(window)) outcome = 'preserved';
    else if (transcribed === normalize(correctedWindow)) outcome = 'corrected';
    return {
      kind: error.kind,
      written: error.written,
      correct: error.correct,
      transcribed,
      outcome,
    };
  });
}
