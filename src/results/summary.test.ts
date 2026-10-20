import { describe, expect, it } from 'vitest';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { PageEntry } from '../pipeline/runner.ts';
import { buildResults, classTotals, countPageWords, isComplete } from './summary.ts';

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

function entry(
  status: PageEntry['status'],
  text = '',
  hasTranscript = status === 'done',
): PageEntry {
  return { status, text, hasTranscript, edited: false, rotation: 0, error: null };
}

function arbeit(id: string, pages: readonly ImportPage[]): Arbeit {
  return { id, name: id, pages };
}

const aufsatz = arbeit('Aufsatz', [
  page('a', 'aufsatz.pdf, Seite 1'),
  page('b', 'aufsatz.pdf, Seite 2'),
]);
const einzel = arbeit('Einzel', [page('c', 'x.png')]);
const klasse = [aufsatz, einzel];

const wordsOf = (arbeiten: readonly Arbeit[], entries: Record<string, PageEntry>) =>
  buildResults(arbeiten, entries).map((result) => result.words);

describe('countPageWords', () => {
  it('counts across lines and joins hyphenated line breaks', () => {
    expect(countPageWords('Wir gingen in den Wald ge-\ngangen und lachten.')).toBe(8);
    expect(countPageWords('')).toBe(0);
  });
});

describe('buildResults', () => {
  it('sums the pages of each Arbeit and numbers the pages within it', () => {
    const results = buildResults(klasse, {
      a: entry('done', 'eins zwei'),
      b: entry('done', 'drei'),
      c: entry('done', 'vier fünf sechs'),
    });
    expect(results).toMatchObject([
      { id: 'Aufsatz', pageCount: 2, words: 3, countedPages: 2 },
      { id: 'Einzel', pageCount: 1, words: 3, countedPages: 1 },
    ]);
    expect(results[0]?.rows.map((row) => row.position)).toEqual([1, 2]);
  });

  it('lists only pages with entries, numbered by their position in the Arbeit', () => {
    const [first, second] = buildResults(klasse, {
      b: entry('done', 'eins zwei'),
      a: entry('waiting'),
    });
    expect(first?.rows).toMatchObject([
      { id: 'a', position: 1, status: 'waiting', words: null },
      { id: 'b', position: 2, status: 'done', words: 2 },
    ]);
    expect(second?.rows).toEqual([]);
  });

  it('ignores entries of pages that are gone', () => {
    expect(
      buildResults([arbeit('x', [page('a', 'a.png')])], { z: entry('done', 'weg') }),
    ).toMatchObject([{ rows: [], words: 0 }]);
  });

  it('reflects edited text immediately', () => {
    expect(wordsOf(klasse, { a: entry('done', 'eins') })).toEqual([1, 0]);
    expect(wordsOf(klasse, { a: entry('done', 'eins zwei drei') })).toEqual([3, 0]);
  });

  it('keeps counting the old transcript while a page is recognised again', () => {
    expect(
      wordsOf(klasse, { a: { ...entry('running', 'eins zwei'), hasTranscript: true } })[0],
    ).toBe(2);
  });

  describe('hyphenation across pages', () => {
    const texts = { a: 'Wir sind ge-', b: 'gangen und\nlachten' };

    it('counts the split word once, on the page where it begins', () => {
      const [result] = buildResults(klasse, {
        a: entry('done', texts.a),
        b: entry('done', texts.b),
      });
      expect(result?.rows.map((row) => row.words)).toEqual([3, 2]);
      expect(result?.words).toBe(countPageWords(`${texts.a}${texts.b}`));
      expect(result?.words).toBe(5);
    });

    it('does not join pages that are not neighbours', () => {
      const gap = [arbeit('f', [page('a', 'a'), page('m', 'm'), page('b', 'b')])];
      expect(wordsOf(gap, { a: entry('done', texts.a), b: entry('done', texts.b) })).toEqual([6]);
    });

    it('does not join the last page of one Arbeit with the first page of the next', () => {
      const split = [arbeit('eins', [page('a', 'a')]), arbeit('zwei', [page('b', 'b')])];
      expect(wordsOf(split, { a: entry('done', texts.a), b: entry('done', texts.b) })).toEqual([
        3, 3,
      ]);
    });

    it('joins pages that were combined into one Arbeit', () => {
      const combined = [arbeit('beide', [page('a', 'a'), page('b', 'b')])];
      expect(wordsOf(combined, { a: entry('done', texts.a), b: entry('done', texts.b) })).toEqual([
        5,
      ]);
    });

    it('does not join when the next page starts with a capital letter', () => {
      expect(
        wordsOf(klasse, { a: entry('done', texts.a), b: entry('done', 'Gangen und lachten') }),
      ).toEqual([6, 0]);
    });

    it('does not join when the previous page has no transcript yet', () => {
      expect(wordsOf(klasse, { a: entry('error'), b: entry('done', texts.b) })).toEqual([3, 0]);
    });
  });
});

describe('classTotals', () => {
  it('sums the class and averages over the complete Arbeiten', () => {
    const results = buildResults(klasse, {
      a: entry('done', 'eins zwei'),
      b: entry('done', 'drei'),
      c: entry('done', 'vier fünf sechs vier'),
    });
    expect(results.every(isComplete)).toBe(true);
    expect(classTotals(results)).toEqual({
      arbeiten: 2,
      pages: 3,
      countedPages: 3,
      words: 7,
      completeArbeiten: 2,
      average: 3.5,
    });
  });

  it('leaves partly counted Arbeiten out of the average but not out of the total', () => {
    const results = buildResults(klasse, {
      a: entry('done', 'eins zwei'),
      c: entry('done', 'drei vier fünf'),
    });
    expect(classTotals(results)).toMatchObject({
      words: 5,
      countedPages: 2,
      completeArbeiten: 1,
      average: 3,
    });
  });

  it('has no average before anything is complete', () => {
    expect(classTotals(buildResults(klasse, {})).average).toBeNull();
  });
});
