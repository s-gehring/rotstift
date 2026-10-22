import { describe, expect, it } from 'vitest';
import type { Mark } from '../src/annotations/transcript.ts';
import type { Corrector } from '../src/correction/corrector.ts';
import { DEUTSCH } from '../src/annotations/profile.ts';
import { combineMarks } from './gruendlich-union.ts';
import { applyRule, confirmedWords, parseRules } from './gruendlich-zweite-lesung.ts';
import { repeated } from './profiles.ts';

const at = (line: number, offset: number, original: string): Mark & { line: number } => ({
  kind: 'error',
  type: 'R',
  original,
  correction: original.toUpperCase(),
  offset,
  line,
});

describe('combineMarks', () => {
  const a = at(1, 4, 'Hunt');
  const b = at(1, 5, 'unt');
  const c = at(2, 0, 'dass');

  it('keeps one mark per overlapping place in the union', () => {
    expect(combineMarks([[a, c], [b]], 1)).toEqual([a, c]);
  });

  it('keeps only places enough runs agree on', () => {
    expect(combineMarks([[a, c], [b], []], 2)).toEqual([a]);
  });

  it('does not count marks on other lines as votes', () => {
    expect(combineMarks([[at(1, 0, 'dass')], [c]], 2)).toEqual([]);
  });
});

describe('confirmedWords', () => {
  it('confirms words the second reading has at the aligned place', () => {
    expect(confirmedWords(['Der', 'Hunt', 'bellt', 'laut'], ['Der', 'Hund', 'bellt'])).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
});

describe('applyRule', () => {
  it('uses the threshold that matches whether a word is confirmed', () => {
    const lines = [
      [
        { text: 'Der', confidence: 0.9 },
        { text: 'Hunt', confidence: 0.9 },
      ],
    ];
    const [rule] = parseRules('0.8/1.01');
    expect(rule).toEqual({ confirmedBelow: 0.8, unconfirmedBelow: 1.01 });
    const result = applyRule(lines, [true, false], rule!);
    expect(result[0]!.map((word) => word.confidence)).toEqual([1, 0]);
  });
});

describe('repeated', () => {
  it('feeds each pass the previous correction and stops when the line count changes', async () => {
    const seen: string[][] = [];
    const answers = ['a\nb', 'a\nB', 'only one line'];
    const inner: Corrector = {
      correct: async (lines) => {
        seen.push([...lines]);
        return { ok: true, correctedText: answers[seen.length - 1] ?? '' };
      },
    };
    const result = await repeated(inner, 4).correct(
      ['x', 'y'],
      DEUTSCH,
      new AbortController().signal,
    );
    expect(seen).toEqual([
      ['x', 'y'],
      ['a', 'b'],
      ['a', 'B'],
    ]);
    expect(result).toEqual({ ok: true, correctedText: 'only one line' });
  });
});
