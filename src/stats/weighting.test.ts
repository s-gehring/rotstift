import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH, SACHFACH } from '../annotations/profile.ts';
import type { Mark, Transcript } from '../annotations/transcript.ts';
import {
  combineWeighted,
  defaultWeighting,
  formatWeighted,
  sameWeighting,
  weightedErrors,
  weightedStatistics,
  weightOf,
} from './weighting.ts';

function error(type: string, original: string, correction: string): Mark {
  return { kind: 'error', type, original, correction, offset: 0 };
}

function omission(type: string, correction: string): Mark {
  return { kind: 'omission', type, original: '', correction, offset: 0 };
}

function page(...marks: Mark[]): Transcript {
  return { lines: [{ number: 1, text: '', marks }] };
}

describe('defaultWeighting', () => {
  it('counts every error kind once in German and in Sachfach', () => {
    for (const profile of [DEUTSCH, SACHFACH]) {
      const weighting = defaultWeighting(profile);
      expect(Object.keys(weighting.weights).toSorted()).toEqual(profile.allowedTypes.toSorted());
      expect(Object.values(weighting.weights).every((weight) => weight === 1)).toBe(true);
      expect(weighting.repeatsOnce).toBe(true);
    }
  });

  it('halves spelling and ignores punctuation in foreign languages', () => {
    const weighting = defaultWeighting(ENGLISCH);
    expect(weighting.weights).toMatchObject({ sp: 0.5, p: 0, gr: 1, t: 1, voc: 1 });
  });

  it('treats unknown kinds as full errors', () => {
    expect(weightOf(defaultWeighting(DEUTSCH), 'X')).toBe(1);
  });
});

describe('weightedErrors', () => {
  const german = defaultWeighting(DEUTSCH);

  it('sums the weight of every error', () => {
    const weighting = { ...german, weights: { ...german.weights, R: 0.5, G: 2 } };
    const transcripts = [page(error('R', 'a', 'b'), error('G', 'c', 'd'), error('A', 'e', 'f'))];
    expect(weightedErrors(transcripts, DEUTSCH, weighting)).toBe(3.5);
  });

  it('counts the same wrong word with the same correction once across pages', () => {
    const transcripts = [
      page(error('R', 'Rutche', 'Rutsche'), error('R', 'Hunt', 'Hund')),
      page(error('R', 'Rutche', 'Rutsche')),
    ];
    expect(weightedErrors(transcripts, DEUTSCH, german)).toBe(2);
  });

  it('counts every repeat when repeats are switched off', () => {
    const transcripts = [page(error('R', 'Rutche', 'Rutsche'), error('R', 'Rutche', 'Rutsche'))];
    expect(weightedErrors(transcripts, DEUTSCH, { ...german, repeatsOnce: false })).toBe(2);
  });

  it('keeps errors with another correction or another kind apart', () => {
    const transcripts = [
      page(
        error('R', 'Rutche', 'Rutsche'),
        error('R', 'Rutche', 'Rutschen'),
        error('G', 'Rutche', 'Rutsche'),
      ),
    ];
    expect(weightedErrors(transcripts, DEUTSCH, german)).toBe(3);
  });

  it('never merges punctuation, omissions or das/dass', () => {
    const transcripts = [
      page(
        error('Z', 'dass', 'dass,'),
        error('Z', 'dass', 'dass,'),
        omission('Z', ','),
        omission('Z', ','),
        error('R', 'das', 'dass'),
        error('R', 'das', 'dass'),
        error('R', 'dass', 'das'),
      ),
    ];
    expect(weightedErrors(transcripts, DEUTSCH, german)).toBe(7);
  });

  it('applies the foreign-language defaults', () => {
    const transcripts = [
      page(
        error('sp', 'recieve', 'receive'),
        error('sp', 'beleive', 'believe'),
        error('p', 'but', 'but,'),
        error('gr', 'he go', 'he goes'),
      ),
    ];
    expect(weightedErrors(transcripts, ENGLISCH, defaultWeighting(ENGLISCH))).toBe(2);
  });
});

describe('weightedStatistics', () => {
  const german = defaultWeighting(DEUTSCH);

  it('relates the weighted errors to 100 words', () => {
    const transcripts = [page(error('R', 'a', 'b'), error('G', 'c', 'd'))];
    expect(weightedStatistics(80, transcripts, DEUTSCH, german)).toEqual({
      words: 80,
      weighted: 2,
      quotient: 2.5,
    });
  });

  it('has quotient 0 without words', () => {
    expect(weightedStatistics(0, [], DEUTSCH, german).quotient).toBe(0);
  });

  it('combines by summing errors and words', () => {
    expect(
      combineWeighted([
        { words: 100, weighted: 2, quotient: 2 },
        { words: 50, weighted: 4, quotient: 8 },
      ]),
    ).toEqual({ words: 150, weighted: 6, quotient: 4 });
    expect(combineWeighted([])).toBeNull();
  });
});

describe('sameWeighting', () => {
  it('compares weights of the profile and the repeat switch', () => {
    const base = defaultWeighting(DEUTSCH);
    expect(sameWeighting(DEUTSCH, base, { ...base })).toBe(true);
    expect(sameWeighting(DEUTSCH, base, { ...base, repeatsOnce: false })).toBe(false);
    expect(sameWeighting(DEUTSCH, base, { ...base, weights: { ...base.weights, R: 0.5 } })).toBe(
      false,
    );
  });
});

describe('formatWeighted', () => {
  it('uses German decimals without trailing zeros', () => {
    expect(formatWeighted(3)).toBe('3');
    expect(formatWeighted(2.5)).toBe('2,5');
    expect(formatWeighted(0)).toBe('0');
  });
});
