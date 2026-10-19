import { describe, expect, it } from 'vitest';
import type { ImportPage } from '../import/pages.ts';
import type { PageEntry } from '../pipeline/runner.ts';
import { buildRows, countPageWords, formatSummary, totalWords } from './summary.ts';

function page(id: string, label: string, fileKey = id): ImportPage {
  return {
    id,
    fileKey,
    label,
    source: { kind: 'image', file: new File([], label) },
    width: 1,
    height: 1,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

function entry(
  status: PageEntry['status'],
  text = '',
  hasTranscript = status === 'done',
): PageEntry {
  return { status, text, hasTranscript, edited: false, rotation: 0, error: null };
}

const pages = [
  page('a', 'aufsatz.pdf, Seite 1', 'aufsatz'),
  page('b', 'aufsatz.pdf, Seite 2', 'aufsatz'),
  page('c', 'x.png'),
];

describe('countPageWords', () => {
  it('counts across lines and joins hyphenated line breaks', () => {
    expect(countPageWords('Wir gingen in den Wald ge-\ngangen und lachten.')).toBe(8);
    expect(countPageWords('')).toBe(0);
  });
});

describe('buildRows', () => {
  it('lists only pages with entries, numbered by their position', () => {
    const rows = buildRows(pages, { c: entry('done', 'eins zwei'), a: entry('waiting') });
    expect(rows).toMatchObject([
      { id: 'a', position: 1, status: 'waiting', words: null },
      { id: 'c', position: 3, status: 'done', words: 2 },
    ]);
  });

  it('ignores entries of pages that are gone', () => {
    expect(buildRows([page('a', 'a.png')], { z: entry('done', 'weg') })).toEqual([]);
  });

  it('reflects edited text immediately', () => {
    const before = buildRows(pages, { a: entry('done', 'eins') });
    const after = buildRows(pages, { a: entry('done', 'eins zwei drei') });
    expect([totalWords(before), totalWords(after)]).toEqual([1, 3]);
  });

  it('keeps counting the old transcript while a page is recognised again', () => {
    const rows = buildRows(pages, { a: { ...entry('running', 'eins zwei'), hasTranscript: true } });
    expect(rows[0]?.words).toBe(2);
  });

  describe('hyphenation across pages', () => {
    const texts = { a: 'Wir sind ge-', b: 'gangen und\nlachten' };

    it('counts the split word once, on the page where it begins', () => {
      const rows = buildRows(pages, { a: entry('done', texts.a), b: entry('done', texts.b) });
      expect(rows.map((row) => row.words)).toEqual([3, 2]);
      expect(totalWords(rows)).toBe(countPageWords(`${texts.a}${texts.b}`));
      expect(totalWords(rows)).toBe(5);
    });

    it('does not join pages that are not neighbours', () => {
      const gap = [page('a', 'a', 'f'), page('m', 'm', 'other'), page('b', 'b', 'f')];
      const rows = buildRows(gap, { a: entry('done', texts.a), b: entry('done', texts.b) });
      expect(totalWords(rows)).toBe(6);
    });

    it('does not join pages of different files', () => {
      const rows = buildRows(pages, { b: entry('done', texts.a), c: entry('done', texts.b) });
      expect(totalWords(rows)).toBe(6);
    });

    it('does not join when the next page starts with a capital letter', () => {
      const rows = buildRows(pages, {
        a: entry('done', texts.a),
        b: entry('done', 'Gangen und lachten'),
      });
      expect(totalWords(rows)).toBe(6);
    });

    it('does not join when the previous page has no transcript yet', () => {
      const rows = buildRows(pages, { a: entry('error'), b: entry('done', texts.b) });
      expect(totalWords(rows)).toBe(3);
    });
  });
});

describe('formatSummary', () => {
  it('lists file, page, words and the total', () => {
    const rows = buildRows(pages, {
      a: entry('done', 'eins zwei drei'),
      b: entry('error'),
      c: entry('done', 'vier'),
    });
    expect(formatSummary(rows, 3)).toBe(
      [
        'Wortzählung',
        'Seite 1 (aufsatz.pdf, Seite 1): 3 Wörter',
        'Seite 2 (aufsatz.pdf, Seite 2): Nicht erkannt',
        'Seite 3 (x.png): 1 Wort',
        'Gesamt (2 von 3 Seiten): 4 Wörter',
      ].join('\n'),
    );
  });

  it('omits the page scope when every page is counted', () => {
    const rows = buildRows(pages, { a: entry('done', 'eins'), b: entry('done', 'zwei') });
    expect(formatSummary(rows, 2).split('\n').at(-1)).toBe('Gesamt: 2 Wörter');
  });

  it('counts pages without entries as missing and formats big numbers the German way', () => {
    const rows = buildRows(pages, { a: entry('done', Array(1234).fill('wort').join(' ')) });
    expect(formatSummary(rows, 12).split('\n').at(-1)).toBe(
      'Gesamt (1 von 12 Seiten): 1.234 Wörter',
    );
  });
});
