import { describe, expect, it } from 'vitest';
import { formatClipboardTable, formatCsv } from './export-table.ts';
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
