import { describe, expect, it } from 'vitest';
import { formatClipboardTable, formatCsv, incompleteNote } from './export-table.ts';
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
      '\uFEFFName;Seiten;Wörter\r\nAnna;2;1234\r\nBen;1;87\r\nGesamt;3;1321\r\n',
    );
  });

  it('writes plain integers without thousands separators', () => {
    expect(formatCsv([result('Anna', 1, 1, 12_345)])).toContain('Anna;1;12345');
  });

  it('quotes names with semicolons, quotes and line breaks', () => {
    const csv = formatCsv([result('Müller; Anna', 1, 1, 1), result('Der "Rote" Stift', 1, 1, 2)]);
    expect(csv).toContain('"Müller; Anna";1;1');
    expect(csv).toContain('"Der ""Rote"" Stift";1;2');
  });

  it('neutralises names that a spreadsheet would read as a formula', () => {
    const csv = formatCsv([result('=SUMME(A1)', 1, 1, 1), result('+49 Anna', 1, 1, 1)]);
    expect(csv).toContain("'=SUMME(A1);1;1");
    expect(csv).toContain("'+49 Anna;1;1");
  });

  it('leaves the words empty for an Arbeit that is not counted yet', () => {
    const csv = formatCsv([result('Anna', 2, 0, 0), result('Ben', 1, 1, 5)]);
    expect(csv).toContain('Anna;2;\r\n');
    expect(csv).toContain('Gesamt;3;5\r\n');
  });

  it('only has the header and a total row without Arbeiten', () => {
    expect(formatCsv([])).toBe('\uFEFFName;Seiten;Wörter\r\nGesamt;0;\r\n');
  });
});

describe('formatClipboardTable', () => {
  it('separates the columns with tabs and has no byte order mark', () => {
    expect(formatClipboardTable(klasse)).toBe(
      'Name\tSeiten\tWörter\nAnna\t2\t1234\nBen\t1\t87\nGesamt\t3\t1321',
    );
  });

  it('flattens tabs and line breaks inside a name', () => {
    expect(formatClipboardTable([result('Anna\tB\nC', 1, 1, 1)])).toContain('Anna B C\t1\t1');
  });
});

describe('incompleteNote', () => {
  it('is silent when every Arbeit is counted', () => {
    expect(incompleteNote(klasse)).toBeNull();
  });

  it('counts the Arbeiten that are missing pages', () => {
    expect(incompleteNote([result('Anna', 2, 1, 3), result('Ben', 1, 1, 1)])).toBe(
      '1 Arbeit ist noch nicht vollständig gezählt.',
    );
    expect(incompleteNote([result('Anna', 2, 1, 3), result('Ben', 1, 0, 0)])).toBe(
      '2 Arbeiten sind noch nicht vollständig gezählt.',
    );
  });
});
