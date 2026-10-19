import { describe, expect, it } from 'vitest';
import type { Transcript } from '../annotations/transcript.ts';
import { computeStatistics } from './statistics.ts';

const essay: Transcript = {
  lines: [
    {
      number: 1,
      text: 'Am Wochenende ich war mit meiner Familie im Schwimbad.',
      marks: [
        { kind: 'error', type: 'Sb', original: 'ich war', correction: 'war ich', offset: 14 },
        { kind: 'error', type: 'R', original: 'Schwimbad', correction: 'Schwimmbad', offset: 44 },
      ],
    },
    {
      number: 2,
      text: 'Wir sind früh losgefahren weil mein Bruder rutschen wollte.',
      marks: [
        { kind: 'omission', type: 'Z', original: '', correction: ',', offset: 25 },
        { kind: 'error', type: 'R', original: 'rutschen', correction: 'rutschen', offset: 42 },
      ],
    },
  ],
};

describe('computeStatistics', () => {
  it('counts words, errors in total and per type', () => {
    const statistics = computeStatistics(essay);
    expect(statistics.words).toBe(18);
    expect(statistics.errors).toBe(4);
    expect(statistics.errorsByType).toEqual({ Sb: 1, R: 2, Z: 1 });
  });

  it('computes errors per 100 words', () => {
    expect(computeStatistics(essay).errorsPer100Words).toBeCloseTo((4 / 18) * 100, 10);
  });

  it('counts omissions as errors but not as words', () => {
    const transcript: Transcript = {
      lines: [
        {
          number: 1,
          text: 'Ich glaube dass es geht',
          marks: [{ kind: 'omission', type: 'Z', original: '', correction: ',', offset: 10 }],
        },
      ],
    };
    expect(computeStatistics(transcript)).toMatchObject({
      words: 5,
      errors: 1,
      errorsPer100Words: 20,
    });
  });

  it('handles a transcript without errors', () => {
    const transcript: Transcript = {
      lines: [{ number: 1, text: 'Alles ist richtig.', marks: [] }],
    };
    expect(computeStatistics(transcript)).toEqual({
      words: 3,
      errors: 0,
      errorsByType: {},
      errorsPer100Words: 0,
    });
  });

  it('avoids a division by zero for an empty transcript', () => {
    expect(computeStatistics({ lines: [] })).toEqual({
      words: 0,
      errors: 0,
      errorsByType: {},
      errorsPer100Words: 0,
    });
  });

  it('does not join words across line breaks', () => {
    const transcript: Transcript = {
      lines: [
        { number: 1, text: 'Der Hund', marks: [] },
        { number: 2, text: 'bellt laut', marks: [] },
      ],
    };
    expect(computeStatistics(transcript).words).toBe(4);
  });
});
