import { describe, expect, it } from 'vitest';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ReviewPage, ReviewState } from './review-flow.ts';
import {
  combineStatistics,
  incompleteText,
  sortedTypes,
  summarizeArbeit,
  summarizeClass,
  type Entries,
} from './summary.ts';
import { page } from './test-support.ts';

function reviewPage(status: ReviewPage['status'], words = 0, byType: Record<string, number> = {}) {
  const errors = Object.values(byType).reduce((sum, count) => sum + count, 0);
  return {
    status,
    rotation: 0,
    source: null,
    image: null,
    bboxes: null,
    warning: null,
    message: null,
    detail: null,
    result:
      status === 'done'
        ? {
            transcript: { lines: [] },
            baseTranscript: { lines: [] },
            hints: [],
            statistics: {
              words,
              errors,
              errorsByType: byType,
              errorsPer100Words: words === 0 ? 0 : (errors / words) * 100,
            },
            droppedMarks: 0,
            unplacedLines: [],
            preview: false,
          }
        : null,
  } satisfies ReviewPage;
}

const state: ReviewState = {
  profile: null,
  run: null,
  stopping: false,
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
    expect(summarizeArbeit(first, state, {})).toMatchObject({
      pageCount: 4,
      corrected: 2,
      empty: 1,
      problems: 1,
      open: 0,
      complete: false,
      statistics: { words: 150, errors: 7 },
    });
    expect(incompleteText(summarizeArbeit(first, state, {}))).toBe(
      'Unvollständig: 3 von 4 Seiten berichtigt',
    );
  });

  it('counts empty pages as handled', () => {
    const arbeit: Arbeit = { id: 'w', name: 'Kurz', pages: [page('a'), page('c')] };
    expect(summarizeArbeit(arbeit, state, {})).toMatchObject({ complete: true, empty: 1 });
  });

  it('leaves out pages whose text or rotation changed after the review', () => {
    const [first] = arbeiten;
    if (first === undefined) throw new Error('missing arbeit');
    const entries: Entries = {
      b: {
        status: 'done',
        text: 'Neu bearbeitet.',
        hasTranscript: true,
        edited: true,
        rotation: 0,
        error: null,
        reading: null,
      },
    };
    const rotated: Arbeit = {
      ...first,
      pages: first.pages.map((p) => (p.id === 'a' ? { ...p, rotation: 90 as const } : p)),
    };
    expect(summarizeArbeit(rotated, state, entries)).toMatchObject({
      corrected: 0,
      stale: 2,
      complete: false,
      statistics: null,
    });
  });
});

describe('summarizeClass', () => {
  it('totals only arbeiten with corrected pages', () => {
    const summary = summarizeClass(arbeiten, state, {});
    expect(summary.reviewed).toBe(2);
    expect(summary.incomplete).toBe(1);
    expect(summary.statistics).toMatchObject({
      words: 350,
      errors: 11,
      errorsByType: { R: 4, Z: 5, G: 2 },
    });
    expect(summary.arbeiten[2]).toMatchObject({ statistics: null, open: 1 });
  });
});
