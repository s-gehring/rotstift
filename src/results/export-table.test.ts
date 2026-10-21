import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import type { ArbeitReview } from '../review/summary.ts';
import type { Statistics } from '../stats/statistics.ts';
import { defaultGrading } from '../stats/grading.ts';
import { defaultWeighting } from '../stats/weighting.ts';
import {
  csvFileName,
  formatClipboardTable,
  formatCsv,
  type CorrectionColumns,
} from './export-table.ts';
import type { ArbeitResult } from './summary.ts';

function result(
  name: string,
  pageCount: number,
  countedPages: number,
  words: number,
): ArbeitResult {
  return { id: name, name, pageCount, rows: [], words, countedPages };
}

const klasse = [result('Anna', 2, 2, 1234), result('Ben', 1, 1, 87)];

describe('formatCsv', () => {
  it('starts with a byte order mark and uses semicolons and CRLF', () => {
    expect(formatCsv(klasse)).toBe(
      '\uFEFFName;Seiten;Wörter;Hinweis\r\nAnna;2;1234;\r\nBen;1;87;\r\nGesamt;3;1321;\r\n',
    );
  });

  it('writes plain integers without thousands separators', () => {
    expect(formatCsv([result('Anna', 1, 1, 12_345)])).toContain('Anna;1;12345;');
  });

  it('quotes names with semicolons, quotes and line breaks', () => {
    const csv = formatCsv([result('Müller; Anna', 1, 1, 1), result('Der "Rote" Stift', 1, 1, 2)]);
    expect(csv).toContain('"Müller; Anna";1;1;');
    expect(csv).toContain('"Der ""Rote"" Stift";1;2;');
  });

  it.each(['=SUMME(A1)', '+49 Anna', '-Anna', '@Anna', '\tAnna', '\rAnna'])(
    'neutralises the name %j that a spreadsheet would read as a formula',
    (name) => {
      const field =
        formatCsv([result(name, 1, 1, 1)])
          .split('\r\n')[1]
          ?.split(';')[0] ?? '';
      expect(field.replaceAll('"', '')).toBe(`'${name}`);
    },
  );

  it('neutralises and quotes a name that needs both', () => {
    expect(formatCsv([result('-a;b', 1, 1, 1)])).toContain('"\'-a;b";1;1;');
  });

  it('leaves words empty and explains it for a partly counted Arbeit', () => {
    const csv = formatCsv([result('Anna', 3, 2, 40), result('Ben', 1, 1, 5)]);
    expect(csv).toContain('Anna;3;;Unvollständig: 2 von 3 Seiten gezählt\r\n');
    expect(csv).toContain('Ben;1;5;\r\n');
  });

  it('leaves the total empty as soon as one Arbeit is incomplete', () => {
    const csv = formatCsv([result('Anna', 2, 0, 0), result('Ben', 1, 1, 5)]);
    expect(csv).toContain('Anna;2;;Unvollständig: 0 von 2 Seiten gezählt\r\n');
    expect(csv).toContain('Gesamt;3;;Unvollständig: 1 von 2 Arbeiten vollständig gezählt\r\n');
  });

  it('only has the header and a total row without Arbeiten', () => {
    expect(formatCsv([])).toBe('\uFEFFName;Seiten;Wörter;Hinweis\r\nGesamt;0;0;\r\n');
  });
});

describe('formatClipboardTable', () => {
  it('separates the columns with tabs and has no byte order mark', () => {
    expect(formatClipboardTable(klasse)).toBe(
      'Name\tSeiten\tWörter\tHinweis\nAnna\t2\t1234\t\nBen\t1\t87\t\nGesamt\t3\t1321\t',
    );
  });

  it('flattens tabs and line breaks inside a name', () => {
    expect(formatClipboardTable([result('Anna\tB\nC', 1, 1, 1)])).toContain('Anna B C\t1\t1');
  });

  it('marks incomplete Arbeiten like the CSV', () => {
    expect(formatClipboardTable([result('Anna', 3, 2, 40)])).toContain(
      'Anna\t3\t\tUnvollständig: 2 von 3 Seiten gezählt',
    );
  });
});

function review(
  name: string,
  pageCount: number,
  corrected: number,
  statistics: Statistics | null,
  transcripts: readonly Transcript[] = [],
): ArbeitReview {
  return {
    id: name,
    name,
    pageCount,
    corrected,
    empty: 0,
    stale: 0,
    problems: pageCount - corrected,
    open: 0,
    complete: corrected === pageCount,
    preview: false,
    statistics,
    transcripts,
  };
}

function transcript(...marks: [type: string, original: string, correction: string][]): Transcript {
  return {
    lines: [
      {
        number: 1,
        text: marks.map(([, original]) => original).join(' '),
        marks: marks.map(([type, original, correction], index) => ({
          kind: 'error',
          type,
          original,
          correction,
          offset: marks.slice(0, index).reduce((sum, [, word]) => sum + word.length + 1, 0),
        })),
      },
    ],
  };
}

function stats(words: number, errorsByType: Record<string, number>): Statistics {
  const errors = Object.values(errorsByType).reduce((sum, count) => sum + count, 0);
  return { words, errors, errorsByType, errorsPer100Words: (errors / words) * 100 };
}

const corrections: CorrectionColumns = {
  types: ['R', 'Z', 'Gr'],
  arbeiten: [
    review('Anna', 2, 2, stats(70, { R: 2, Gr: 1 }), [
      transcript(['R', 'Rutche', 'Rutsche'], ['Gr', 'ein', 'einen'], ['R', 'Rutche', 'Rutsche']),
    ]),
    review('Ben', 1, 1, stats(30, { Z: 1 }), [transcript(['Z', 'dass', 'dass,'])]),
  ],
  profile: DEUTSCH,
  weighting: defaultWeighting(DEUTSCH),
};

describe('corrected table', () => {
  const klasse100 = [result('Anna', 2, 2, 70), result('Ben', 1, 1, 30)];

  it('adds errors, the rate and one column per error type of the profile', () => {
    expect(formatCsv(klasse100, corrections)).toBe(
      '\uFEFFName;Seiten;Wörter;Fehler;Fehler je 100 Wörter;Gewichtete Fehler;Fehlerquotient;R;Z;Gr;Hinweis\r\n' +
        'Anna;2;70;3;4,3;2;2,9;2;0;1;\r\n' +
        'Ben;1;30;1;3,3;1;3,3;0;1;0;\r\n' +
        'Gesamt;3;100;4;4,0;3;3,0;2;1;1;\r\n',
    );
  });

  it('copies the same columns separated by tabs', () => {
    expect(formatClipboardTable(klasse100, corrections).split('\n')[1]).toBe(
      'Anna\t2\t70\t3\t4,3\t2\t2,9\t2\t0\t1\t',
    );
  });

  it('leaves the error cells empty while an Arbeit is not fully corrected', () => {
    const partly: CorrectionColumns = {
      ...corrections,
      types: ['R'],
      arbeiten: [review('Anna', 2, 1, stats(40, { R: 2 })), review('Ben', 1, 1, null)],
    };
    const csv = formatCsv(klasse100, partly);
    expect(csv).toContain('Anna;2;70;;;;;;Unvollständig: 1 von 2 Seiten korrigiert\r\n');
    expect(csv).toContain('Ben;1;30;0;0,0;0;0,0;0;\r\n');
    expect(csv).toContain(
      'Gesamt;3;100;;;;;;Unvollständig: 1 von 2 Arbeiten vollständig korrigiert',
    );
  });

  it('adds the grade of each complete Arbeit when limits are set', () => {
    const graded: CorrectionColumns = {
      ...corrections,
      grading: {
        ...defaultGrading(),
        enabled: true,
        scale: 'points',
        limits: {
          ...defaultGrading().limits,
          points: [2.9, 3, ...Array.from({ length: 13 }, () => null)],
        },
      },
    };
    expect(formatCsv(klasse100, graded)).toBe(
      '\uFEFFName;Seiten;Wörter;Fehler;Fehler je 100 Wörter;Gewichtete Fehler;Fehlerquotient;Punkte;R;Z;Gr;Hinweis\r\n' +
        'Anna;2;70;3;4,3;2;2,9;15;2;0;1;\r\n' +
        'Ben;1;30;1;3,3;1;3,3;0;0;1;0;\r\n' +
        'Gesamt;3;100;4;4,0;3;3,0;;2;1;1;\r\n',
    );
  });

  it('has no grade column while grading is off', () => {
    const off: CorrectionColumns = { ...corrections, grading: defaultGrading() };
    expect(formatCsv(klasse100, off)).toBe(formatCsv(klasse100, corrections));
  });

  it('protects error type codes in the header against formulas', () => {
    const odd: CorrectionColumns = { ...corrections, types: ['=A'] };
    expect(formatCsv(klasse100, odd)).toContain(";'=A;Hinweis");
  });

  it('names the file after its content', () => {
    expect(csvFileName()).toBe('Wortzahlen');
    expect(csvFileName(corrections)).toBe('Klassenübersicht');
  });
});
