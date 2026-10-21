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

function substitution(a: string, b: string): number {
  if (a === b) return 0;
  const distance = editDistance(Array.from(a), Array.from(b));
  return distance <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 3)) ? 0.6 : 1;
}

export function alignTokens(
  truth: readonly Token[],
  hypothesis: readonly Token[],
): (number | null)[] {
  const a = truth.map((token) => normal(token.word));
  const b = hypothesis.map((token) => normal(token.word));
  const columns = b.length + 1;
  const cost = new Float64Array((a.length + 1) * columns);
  for (let j = 0; j <= b.length; j += 1) cost[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cost[i * columns] = i;
    for (let j = 1; j <= b.length; j += 1) {
      cost[i * columns + j] = Math.min(
        (cost[(i - 1) * columns + j - 1] ?? 0) + substitution(a[i - 1] ?? '', b[j - 1] ?? ''),
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
    const diagonal =
      (cost[(i - 1) * columns + j - 1] ?? 0) + substitution(a[i - 1] ?? '', b[j - 1] ?? '');
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

export function scoreStrikes(truth: readonly Token[], hypothesis: readonly Token[]): StrikeScore {
  const matched = alignTokens(truth, hypothesis);
  const used = new Set<number>();
  let struck = 0;
  let detected = 0;
  let transcribed = 0;
  let omitted = 0;
  truth.forEach((token, index) => {
    const at = matched[index];
    if (at !== null && at !== undefined) used.add(at);
    if (!token.struck) return;
    struck += 1;
    if (at === null || at === undefined) {
      omitted += 1;
    } else if (hypothesis[at]?.struck === true) {
      detected += 1;
    } else {
      transcribed += 1;
    }
  });
  let falseAlarms = 0;
  hypothesis.forEach((token, index) => {
    if (!token.struck) return;
    const owner = matched.indexOf(index);
    if (owner < 0 || truth[owner]?.struck !== true) falseAlarms += 1;
  });
  const kept = truth.filter((token) => !token.struck).map((token) => normal(token.word));
  const counted = hypothesis.filter((token) => !token.struck).map((token) => normal(token.word));
  return {
    struck,
    detected,
    transcribed,
    omitted,
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
