import { describe, expect, it } from 'vitest';
import { confirmedWords, confirmReading } from './second-reading.ts';
import { separateUncertain, type PageReading } from './uncertain-reading.ts';

const reading: PageReading = {
  uncertainBelow: 0.95,
  lines: [
    [
      { text: 'Der', confidence: 0.99 },
      { text: 'Hunt', confidence: 0.9 },
    ],
    [
      { text: 'bellt', confidence: 0.7 },
      { text: 'laut', confidence: 0.99 },
    ],
  ],
};

describe('confirmedWords', () => {
  it('confirms words the second reading has at the aligned place', () => {
    expect(confirmedWords(['Der', 'Hunt', 'bellt', 'laut'], ['Der', 'Hund', 'bellt'])).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it('confirms nothing against an empty second reading', () => {
    expect(confirmedWords(['Der', 'Hund'], [])).toEqual([false, false]);
  });
});

describe('confirmReading', () => {
  it('keeps a word sure only if the second reading agrees and the first was sure enough', () => {
    const confirmed = confirmReading(reading, ['Der Hunt', 'bellt leise']);
    expect(confirmed.lines.map((words) => words.map((word) => word.confidence))).toEqual([
      [1, 1],
      [0, 0],
    ]);
    expect(confirmed.lines[0]?.map((word) => word.text)).toEqual(['Der', 'Hunt']);
  });

  it('reads past the table and emphasis markup of the second reader', () => {
    const confirmed = confirmReading(reading, [
      '<table>',
      '  <tr><td><em>Der Hunt</em></td></tr>',
      '  <tr><td>**bellt** laut</td></tr>',
      '</table>',
    ]);
    expect(confirmed.lines.map((words) => words.map((word) => word.confidence))).toEqual([
      [1, 1],
      [0, 1],
    ]);
  });

  it('turns a mark on a word read differently into a hint', () => {
    const transcript = {
      lines: [
        {
          number: 1,
          text: 'Der Hunt',
          marks: [
            {
              kind: 'error' as const,
              type: 'R',
              original: 'Hunt',
              correction: 'Hund',
              offset: 4,
            },
          ],
        },
        { number: 2, text: 'bellt laut', marks: [] },
      ],
    };
    const agreed = separateUncertain(transcript, confirmReading(reading, ['Der Hunt bellt laut']));
    expect(agreed.hints).toEqual([]);
    expect(agreed.transcript.lines[0]?.marks).toHaveLength(1);
    const differs = separateUncertain(transcript, confirmReading(reading, ['Der Hund bellt laut']));
    expect(differs.transcript.lines[0]?.marks).toEqual([]);
    expect(differs.hints).toMatchObject([{ line: 1, mark: { original: 'Hunt' } }]);
  });
});
