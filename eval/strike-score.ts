import { editDistance } from './metrics.ts';

export interface Token {
  readonly word: string;
  readonly struck: boolean;
}

export interface StrikeScore {
  readonly struck: number;
  readonly detected: number;
  readonly transcribed: number;
  readonly omitted: number;
  readonly falseAlarms: number;
  readonly words: number;
  readonly truthWords: number;
  readonly countedWords: number;
  readonly wordEdits: number;
}

const STRUCK = /^~~(.+)~~$/u;
const STRUCK_MISMATCH = 1e-3;

export function tokens(text: string): Token[] {
  const found: Token[] = [];
  for (const match of text.matchAll(/~~[^~]+~~|\S+/gu)) {
    const struck = STRUCK.exec(match[0]);
    for (const word of (struck?.[1] ?? match[0]).split(/\s+/u)) {
      if (word !== '') found.push({ word, struck: struck !== null });
    }
  }
  return found;
}

function normal(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function swapDistance(a: readonly string[], b: readonly string[]): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const row = rows[i] ?? [];
      row[j] = Math.min(
        (rows[i - 1]?.[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
        (rows[i - 1]?.[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j] ?? 0, (rows[i - 2]?.[j - 2] ?? 0) + 1);
      }
    }
  }
  return rows[a.length]?.[b.length] ?? 0;
}

function substitution(a: string, b: string): number {
  if (a === b) return 0;
  const distance = swapDistance(Array.from(a), Array.from(b));
  return distance <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 3)) ? 0.6 : 1;
}

export function alignTokens(
  truth: readonly Token[],
  hypothesis: readonly Token[],
): (number | null)[] {
  const a = truth.map((token) => normal(token.word));
  const b = hypothesis.map((token) => normal(token.word));
  const pair = (i: number, j: number) =>
    substitution(a[i] ?? '', b[j] ?? '') +
    (truth[i]?.struck === hypothesis[j]?.struck ? 0 : STRUCK_MISMATCH);
  const columns = b.length + 1;
  const cost = new Float64Array((a.length + 1) * columns);
  for (let j = 0; j <= b.length; j += 1) cost[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cost[i * columns] = i;
    for (let j = 1; j <= b.length; j += 1) {
      cost[i * columns + j] = Math.min(
        (cost[(i - 1) * columns + j - 1] ?? 0) + pair(i - 1, j - 1),
        (cost[(i - 1) * columns + j] ?? 0) + 1,
        (cost[i * columns + j - 1] ?? 0) + 1,
      );
    }
  }
  const matched: (number | null)[] = truth.map(() => null);
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    const here = cost[i * columns + j] ?? 0;
    const diagonal = (cost[(i - 1) * columns + j - 1] ?? 0) + pair(i - 1, j - 1);
    if (Math.abs(here - diagonal) < 1e-9 && substitution(a[i - 1] ?? '', b[j - 1] ?? '') < 1) {
      matched[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else if (Math.abs(here - diagonal) < 1e-9) {
      i -= 1;
      j -= 1;
    } else if (Math.abs(here - ((cost[(i - 1) * columns + j] ?? 0) + 1)) < 1e-9) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return matched;
}

export type StrikeOutcome = 'detected' | 'transcribed' | 'omitted';

export function strikeOutcomes(
  truth: readonly Token[],
  hypothesis: readonly Token[],
  matched: readonly (number | null)[] = alignTokens(truth, hypothesis),
): StrikeOutcome[] {
  return truth.flatMap((token, index): StrikeOutcome[] => {
    if (!token.struck) return [];
    const at = matched[index];
    if (at === null || at === undefined) return ['omitted'];
    return [hypothesis[at]?.struck === true ? 'detected' : 'transcribed'];
  });
}

export function scoreStrikes(truth: readonly Token[], hypothesis: readonly Token[]): StrikeScore {
  const matched = alignTokens(truth, hypothesis);
  const outcomes = strikeOutcomes(truth, hypothesis, matched);
  const count = (outcome: StrikeOutcome) => outcomes.filter((value) => value === outcome).length;
  let falseAlarms = 0;
  hypothesis.forEach((token, index) => {
    if (!token.struck) return;
    const owner = matched.indexOf(index);
    if (owner < 0 || truth[owner]?.struck !== true) falseAlarms += 1;
  });
  const kept = truth.filter((token) => !token.struck).map((token) => normal(token.word));
  const counted = hypothesis.filter((token) => !token.struck).map((token) => normal(token.word));
  return {
    struck: outcomes.length,
    detected: count('detected'),
    transcribed: count('transcribed'),
    omitted: count('omitted'),
    falseAlarms,
    words: hypothesis.length,
    truthWords: kept.filter((word) => word !== '').length,
    countedWords: counted.filter((word) => word !== '').length,
    wordEdits: editDistance(kept, counted),
  };
}

export function sumScores(scores: readonly StrikeScore[]): StrikeScore {
  const total = (key: keyof StrikeScore) => scores.reduce((sum, score) => sum + score[key], 0);
  return {
    struck: total('struck'),
    detected: total('detected'),
    transcribed: total('transcribed'),
    omitted: total('omitted'),
    falseAlarms: total('falseAlarms'),
    words: total('words'),
    truthWords: total('truthWords'),
    countedWords: total('countedWords'),
    wordEdits: total('wordEdits'),
  };
}
