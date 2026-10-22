import { describe, expect, it } from 'vitest';
import { matchLines, summaryRow, type PageStats } from './heft-measure.ts';

const truth = [
  { text: 'Liebe Oma, lieber Opa,', bbox: [10, 10, 200, 40] as [number, number, number, number] },
  { text: '', bbox: null },
  {
    text: 'vielen Dank für das Paket',
    bbox: [10, 90, 300, 40] as [number, number, number, number],
  },
];

describe('matchLines', () => {
  it('assigns each transcript line to the most similar truth line', () => {
    expect(matchLines(['vielen dank fur das Paket', 'Liebe Oma lieber Opa'], truth)).toEqual([
      2, 0,
    ]);
  });

  it('leaves lines without a similar truth line unmatched', () => {
    expect(matchLines(['Ganz etwas anderes steht hier'], truth)).toEqual([-1]);
  });

  it('uses each truth line only once', () => {
    expect(matchLines(['Liebe Oma, lieber Opa,', 'Liebe Oma, lieber Opa,'], truth)).toEqual([
      0, -1,
    ]);
  });
});

describe('summaryRow', () => {
  it('reports the share of boxes that hit the truth line', () => {
    const page: PageStats = {
      name: 'a',
      group: 'alle',
      words: 100,
      wordEdits: 10,
      chars: 500,
      charEdits: 25,
      lines: 10,
      located: 9,
      matched: 8,
      hits: 6,
      confidentWrong: 1,
      iouSum: 5,
      alarms: 2,
      crashed: false,
      seconds: 1,
    };
    const cells = summaryRow('x', [page])
      .split('|')
      .map((cell) => cell.trim());
    expect(cells.slice(1, 10)).toEqual([
      'x',
      '1',
      '100',
      '10.0 %',
      '5.0 %',
      '90.0 %',
      '75.0 %',
      '12.5 %',
      '2.00',
    ]);
  });
});
