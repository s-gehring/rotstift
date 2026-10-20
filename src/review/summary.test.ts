import { describe, expect, it } from 'vitest';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ReviewPage, ReviewState } from './review-flow.ts';
import { combineStatistics, sortedTypes, summarizeArbeit, summarizeClass } from './summary.ts';
import { page } from './test-support.ts';

function reviewPage(status: ReviewPage['status'], words = 0, byType: Record<string, number> = {}) {
  const errors = Object.values(byType).reduce((sum, count) => sum + count, 0);
  return {
    status,
    rotation: 0,
    source: null,
    image: null,
    bboxes: null,
    message: null,
    detail: null,
    result:
      status === 'done'
        ? {
            transcript: { lines: [] },
            statistics: {
              words,
              errors,
              errorsByType: byType,
              errorsPer100Words: words === 0 ? 0 : (errors / words) * 100,
            },
            droppedMarks: 0,
            unplacedLines: [],
          }
        : null,
  } satisfies ReviewPage;
}

const state: ReviewState = {
  profile: null,
  run: null,
  outcome: 'finished',
  pages: {
    a: reviewPage('done', 100, { R: 3, Z: 1 }),
    b: reviewPage('done', 50, { R: 1, G: 2 }),
    c: reviewPage('empty'),
    d: reviewPage('failed'),
    e: reviewPage('done', 200, { Z: 4 }),
  },
};

const arbeiten: Arbeit[] = [
  { id: 'x', name: 'Aufsatz Ada', pages: [page('a'), page('b'), page('c'), page('d')] },
  { id: 'y', name: 'Aufsatz Ben', pages: [page('e')] },
  { id: 'z', name: 'Aufsatz Cem', pages: [page('f')] },
];

describe('combineStatistics', () => {
  it('adds words and errors and recomputes the rate', () => {
    expect(
      combineStatistics([
        { words: 100, errors: 4, errorsByType: { R: 3, Z: 1 }, errorsPer100Words: 4 },
        { words: 50, errors: 3, errorsByType: { R: 1, G: 2 }, errorsPer100Words: 6 },
      ]),
    ).toEqual({
      words: 150,
      errors: 7,
      errorsByType: { R: 4, Z: 1, G: 2 },
      errorsPer100Words: (7 / 150) * 100,
    });
  });

  it('returns null without any corrected page', () => {
    expect(combineStatistics([])).toBeNull();
  });
});

describe('sortedTypes', () => {
  it('orders by count and then by the profile order', () => {
    const statistics = {
      words: 10,
      errors: 6,
      errorsByType: { G: 2, Z: 2, R: 2, A: 0 },
      errorsPer100Words: 60,
    };
    expect(sortedTypes(statistics, ['R', 'Z', 'G'])).toEqual([
      { type: 'R', count: 2 },
      { type: 'Z', count: 2 },
      { type: 'G', count: 2 },
    ]);
  });
});

describe('summarizeArbeit', () => {
  it('counts corrected, empty and problem pages', () => {
    const [first] = arbeiten;
    if (first === undefined) throw new Error('missing arbeit');
    expect(summarizeArbeit(first, state)).toMatchObject({
      pageCount: 4,
      corrected: 2,
      empty: 1,
      problems: 1,
      open: 0,
      statistics: { words: 150, errors: 7 },
    });
  });
});

describe('summarizeClass', () => {
  it('totals only arbeiten with corrected pages', () => {
    const summary = summarizeClass(arbeiten, state);
    expect(summary.reviewed).toBe(2);
    expect(summary.statistics).toMatchObject({
      words: 350,
      errors: 11,
      errorsByType: { R: 4, Z: 5, G: 2 },
    });
    expect(summary.arbeiten[2]).toMatchObject({ statistics: null, open: 1 });
  });
});
