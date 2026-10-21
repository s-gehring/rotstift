import { describe, expect, it } from 'vitest';
import type { PageEntry } from '../pipeline/runner.ts';
import { page } from '../review/test-support.ts';
import type { CorrectedPage, ReviewPage, ReviewState } from '../review/review-flow.ts';
import {
  activityText,
  arbeitStatus,
  figureText,
  problemText,
  type Entries,
} from './arbeit-status.ts';
import type { Arbeit } from './arbeiten.ts';

const arbeit: Arbeit = { id: 'x', name: 'Anna', pages: [page('a'), page('b'), page('c')] };

const noReview: ReviewState = {
  pages: {},
  works: {},
  profile: null,
  run: null,
  stopping: false,
  outcome: null,
};

function entry(overrides: Partial<PageEntry> = {}): PageEntry {
  return {
    status: 'done',
    text: 'eins zwei drei',
    hasTranscript: true,
    edited: false,
    rotation: 0,
    error: null,
    reading: null,
    ...overrides,
  };
}

function reviewPage(overrides: Partial<ReviewPage> = {}): ReviewPage {
  return {
    status: 'waiting',
    rotation: 0,
    source: null,
    image: null,
    bboxes: null,
    warning: null,
    result: null,
    message: null,
    detail: null,
    ...overrides,
  };
}

function withReview(pages: Record<string, ReviewPage>, running = false): ReviewState {
  return {
    ...noReview,
    pages,
    run: running ? { phase: 'transcribing', total: 3, finished: 0 } : null,
  };
}

describe('arbeitStatus', () => {
  it('has no figures before anything ran', () => {
    expect(arbeitStatus(arbeit, {}, noReview)).toEqual({
      hasResults: false,
      words: null,
      errors: null,
      uncertain: 0,
      activity: null,
      problems: [],
    });
  });

  it('counts words over all pages and marks a partial count', () => {
    const complete: Entries = { a: entry(), b: entry(), c: entry() };
    expect(arbeitStatus(arbeit, complete, noReview).words).toEqual({ value: 9, partial: false });
    const partial: Entries = { a: entry(), b: entry() };
    const status = arbeitStatus(arbeit, partial, noReview);
    expect(status.words).toEqual({ value: 6, partial: true });
    expect(status.hasResults).toBe(true);
  });

  it('reports the errors of corrected pages', () => {
    const result: CorrectedPage = {
      transcript: { lines: [] },
      baseTranscript: { lines: [] },
      hints: [
        {
          line: 1,
          mark: { kind: 'error', type: 'R', original: 'a', correction: 'x', offset: 0 },
          confidence: 0.4,
          status: 'open',
        },
        {
          line: 1,
          mark: { kind: 'error', type: 'R', original: 'a', correction: 'x', offset: 2 },
          confidence: 0.4,
          status: 'dismissed',
        },
      ],
      statistics: { words: 3, errors: 2, errorsByType: { R: 2 }, errorsPer100Words: 66 },
      droppedMarks: 0,
      unplacedLines: [],
      preview: false,
    };
    const review = withReview({
      a: reviewPage({ status: 'done', source: 'eins zwei drei', result }),
    });
    const status = arbeitStatus(arbeit, { a: entry() }, review);
    expect(status.errors).toEqual({ value: 2, partial: true });
    expect(status.uncertain).toBe(1);
  });

  it('shows what a running Arbeit is doing', () => {
    const waiting = withReview({ a: reviewPage(), b: reviewPage() }, true);
    expect(arbeitStatus(arbeit, {}, waiting).activity).toBe('waiting');
    const recognizing = withReview({ a: reviewPage({ status: 'transcribing' }) }, true);
    expect(arbeitStatus(arbeit, {}, recognizing).activity).toBe('recognizing');
    const correcting = withReview({ a: reviewPage({ status: 'correcting' }) }, true);
    expect(arbeitStatus(arbeit, {}, correcting).activity).toBe('correcting');
    const counting: Entries = { a: entry({ status: 'running' }), b: entry({ status: 'waiting' }) };
    expect(arbeitStatus(arbeit, counting, noReview).activity).toBe('recognizing');
  });

  it('lists failed pages with their message', () => {
    const review = withReview({
      b: reviewPage({ status: 'failed', message: 'Kaputt.' }),
      c: reviewPage({ status: 'cancelled' }),
    });
    const { problems } = arbeitStatus(arbeit, {}, review);
    expect(problems.map((p) => [p.position, p.source, p.text])).toEqual([[2, 'review', 'Kaputt.']]);
    expect(problemText(problems)).toBe('Seite 2: Kaputt.');
  });

  it('lists pages whose recognition failed when only counting', () => {
    const entries: Entries = {
      a: entry({
        status: 'error',
        hasTranscript: false,
        error: { kind: 'failed', message: 'Absturz' },
      }),
      b: entry({ status: 'error', hasTranscript: false, error: { kind: 'cancelled' } }),
    };
    const { problems } = arbeitStatus(arbeit, entries, noReview);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.source).toBe('count');
    expect(problemText([...problems, ...problems])).toBe('2 Seiten mit Fehlern');
  });
});

describe('texts', () => {
  it('formats figures with a lower bound for partial counts', () => {
    expect(figureText({ value: 1, partial: false }, 'Wort', 'Wörter')).toBe('1 Wort');
    expect(figureText({ value: 1200, partial: true }, 'Wort', 'Wörter')).toBe('mind. 1.200 Wörter');
  });

  it('names the activities briefly', () => {
    expect(activityText('waiting')).toBe('Wartet');
    expect(activityText('recognizing')).toBe('Erkennt …');
    expect(activityText('correcting')).toBe('Korrigiert …');
  });
});
