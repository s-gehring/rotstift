import { describe, expect, it } from 'vitest';
import type { ImportPage } from '../import/pages.ts';
import type { PageEntry } from '../pipeline/runner.ts';
import { buildRows, countPageWords, formatSummary, totalWords } from './summary.ts';

function page(id: string, label: string): ImportPage {
  return {
    id,
    fileKey: id,
    label,
    source: { kind: 'image', file: new File([], label) },
    width: 1,
    height: 1,
    rotation: 0,
    thumbnailUrl: `blob:${id}`,
  };
}

function entry(status: PageEntry['status'], text = ''): PageEntry {
  return { status, text, edited: false, rotation: 0, error: null, previous: null };
}

const pages = [
  page('a', 'aufsatz.pdf, Seite 1'),
  page('b', 'aufsatz.pdf, Seite 2'),
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
    expect(rows).toEqual([
      { id: 'a', position: 1, label: 'aufsatz.pdf, Seite 1', status: 'waiting', words: null },
      { id: 'c', position: 3, label: 'x.png', status: 'done', words: 2 },
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
});

describe('formatSummary', () => {
  it('lists file, page, words and the total', () => {
    const rows = buildRows(pages, {
      a: entry('done', 'eins zwei drei'),
      b: entry('error'),
      c: entry('done', 'vier'),
    });
    expect(formatSummary(rows)).toBe(
      [
        'Wortzählung',
        'Seite 1 (aufsatz.pdf, Seite 1): 3 Wörter',
        'Seite 2 (aufsatz.pdf, Seite 2): nicht erkannt',
        'Seite 3 (x.png): 1 Wort',
        'Gesamt: 4 Wörter',
      ].join('\n'),
    );
  });
});
