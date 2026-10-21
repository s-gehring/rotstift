import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { PageEntry, RunState } from '../pipeline/runner.ts';
import { IDLE_ENGINE, type ReviewEngine } from '../review/engine-phase.ts';
import type { ReviewPage, ReviewPhase, ReviewState, RunStages } from '../review/review-flow.ts';
import { page } from '../review/test-support.ts';
import {
  countFinishedText,
  loadRunKind,
  openPageCount,
  readiness,
  reviewFinishedText,
  RUN_KIND_STORAGE_KEY,
  reviewFraction,
  runProgress,
  saveRunKind,
  startDecision,
  startRun,
  type KindStorage,
} from './run.ts';

function entry(text: string, overrides: Partial<PageEntry> = {}): PageEntry {
  return {
    status: 'done',
    text,
    hasTranscript: true,
    edited: false,
    rotation: 0,
    error: null,
    reading: null,
    ...overrides,
  };
}

function runState(entries: Record<string, PageEntry>, overrides: Partial<RunState> = {}): RunState {
  return { entries, batch: null, durationsMs: [], runningSince: null, ...overrides };
}

function reviewed(source: string | null, overrides: Partial<ReviewPage> = {}): ReviewPage {
  return {
    status: 'done',
    rotation: 0,
    source,
    image: null,
    bboxes: null,
    warning: null,
    result: null,
    message: null,
    detail: null,
    ...overrides,
  };
}

function reviewState(
  pages: Record<string, ReviewPage>,
  overrides: Partial<ReviewState> = {},
): ReviewState {
  return {
    pages,
    works: {},
    profile: DEUTSCH,
    run: null,
    stopping: false,
    outcome: null,
    ...overrides,
  };
}

const EMPTY_REVIEW = reviewState({}, { profile: null });

function rotated(source: ImportPage): ImportPage {
  return { ...source, rotation: 90 };
}

describe('readiness', () => {
  it('waits silently while the status is unknown and asks for setup after a load error', () => {
    expect(readiness(null, null)).toBe('checking');
    expect(readiness(null, { kind: 'io' })).toBe('missing');
  });

  it('maps the transcriber and corrector states', () => {
    expect(
      readiness(
        {
          state: 'ready',
          transcriber: { transcribe: () => Promise.reject(new Error()) },
          demo: true,
        },
        null,
      ),
    ).toBe('ready');
    expect(readiness({ state: 'needs-model', problem: 'verifying' }, null)).toBe('missing');
    expect(readiness({ state: 'needs-model', message: 'fehlt' }, null)).toBe('missing');
    expect(readiness({ state: 'unavailable', message: 'nur Desktop' }, null)).toBe('unavailable');
  });
});

describe('startDecision', () => {
  it('starts when every needed model is ready', () => {
    expect(startDecision('count', { transcriber: 'ready', corrector: 'missing' })).toEqual({
      action: 'launch',
    });
    expect(startDecision('correct', { transcriber: 'ready', corrector: 'ready' })).toEqual({
      action: 'launch',
    });
  });

  it('opens the setup for exactly the models the chosen kind is missing', () => {
    expect(startDecision('correct', { transcriber: 'ready', corrector: 'missing' })).toEqual({
      action: 'setup',
      roles: ['corrector'],
    });
    expect(startDecision('correct', { transcriber: 'missing', corrector: 'missing' })).toEqual({
      action: 'setup',
      roles: ['transcriber', 'corrector'],
    });
    expect(startDecision('count', { transcriber: 'missing', corrector: 'missing' })).toEqual({
      action: 'setup',
      roles: ['transcriber'],
    });
  });

  it('waits while a model is still being checked and refuses outside the desktop app', () => {
    expect(startDecision('count', { transcriber: 'checking', corrector: 'ready' })).toEqual({
      action: 'wait',
    });
    expect(startDecision('correct', { transcriber: 'ready', corrector: 'unavailable' })).toEqual({
      action: 'unavailable',
    });
  });
});

describe('open pages for counting', () => {
  const pages = [page('a'), page('b'), page('c'), page('d')];

  it('counts new pages and failed pages without text', () => {
    const state = runState({
      a: entry('eins'),
      b: entry('', {
        status: 'error',
        hasTranscript: false,
        error: { kind: 'failed', message: 'x' },
      }),
    });
    expect(openPageCount('count', pages, state, EMPTY_REVIEW, DEUTSCH)).toBe(3);
  });

  it('counts pages rotated after recognition unless their text was edited', () => {
    const turned = pages.map(rotated);
    const state = runState({
      a: entry('eins'),
      b: entry('zwei', { edited: true }),
      c: entry('drei'),
      d: entry('vier'),
    });
    expect(openPageCount('count', turned, state, EMPTY_REVIEW, DEUTSCH)).toBe(3);
  });

  it('has nothing open when every page is recognised', () => {
    const state = runState({ a: entry('a'), b: entry('b'), c: entry('c'), d: entry('d') });
    expect(openPageCount('count', pages, state, EMPTY_REVIEW, DEUTSCH)).toBe(0);
  });
});

describe('open pages for correcting', () => {
  const pages = [page('a'), page('b'), page('c')];
  const count = runState({ a: entry('eins'), b: entry(''), c: entry('drei') });

  it('treats corrected and empty pages as done and the rest as open', () => {
    const review = reviewState({
      a: reviewed('eins'),
      b: reviewed('', { status: 'empty' }),
    });
    expect(openPageCount('correct', pages, count, review, DEUTSCH)).toBe(1);
  });

  it('reopens pages that were rotated or edited after the correction', () => {
    const review = reviewState({
      a: reviewed('alt'),
      b: reviewed('', { status: 'empty' }),
      c: reviewed('drei', { rotation: 90 }),
    });
    expect(openPageCount('correct', pages, count, review, DEUTSCH)).toBe(2);
  });

  it('reopens failed pages', () => {
    const review = reviewState({
      a: reviewed('eins', { status: 'failed' }),
      b: reviewed('', { status: 'empty' }),
      c: reviewed('drei'),
    });
    expect(openPageCount('correct', pages, count, review, DEUTSCH)).toBe(1);
  });

  it('reopens everything after the subject changed', () => {
    const review = reviewState({ a: reviewed('eins'), b: reviewed('', { status: 'empty' }) });
    expect(openPageCount('correct', pages, count, review, ENGLISCH)).toBe(3);
  });
});

const pending = (status: PageEntry['status']) => entry('', { status });

describe('runProgress', () => {
  const waiting = reviewed(null, { status: 'waiting' });

  it('shows nothing while idle', () => {
    expect(runProgress(EMPTY_REVIEW, runState({}), IDLE_ENGINE, 0)).toBeNull();
  });

  it('counts finished pages while counting words and says when the model loads', () => {
    const counting = runState({}, { batch: { total: 3, finished: 1 } });
    expect(runProgress(EMPTY_REVIEW, counting, IDLE_ENGINE, 0)).toEqual({
      label: 'Seite 1 von 3',
      detail: null,
      value: 1,
      max: 3,
    });
    expect(
      runProgress(EMPTY_REVIEW, counting, { transcriber: 'starting', corrector: 'idle' }, 0)
        ?.detail,
    ).toBe('Modell wird geladen …');
  });

  it('estimates the remaining time of counting once a page has been measured', () => {
    const counting = runState(
      {},
      { batch: { total: 3, finished: 1 }, durationsMs: [30_000], runningSince: 0 },
    );
    expect(runProgress(EMPTY_REVIEW, counting, IDLE_ENGINE, 0)?.detail).toBe('noch etwa 1 Minute');
  });

  it('fills one bar over all steps of a correction run without naming them', () => {
    const begin = reviewState(
      { a: waiting, b: waiting },
      { run: { phase: 'transcribing', total: 2, finished: 0 } },
    );
    const queued = runState({ a: pending('waiting'), b: pending('waiting') });
    const start = startRun(begin, queued, 0);
    const steps: [ReviewState, RunState][] = [
      [begin, queued],
      [begin, runState({ a: pending('done'), b: pending('running') })],
      [
        reviewState(begin.pages, { run: { phase: 'transcribing', total: 0, finished: 0 } }),
        runState({ a: pending('done'), b: pending('error') }),
      ],
      [reviewState(begin.pages, { run: { phase: 'locating', total: 2, finished: 0 } }), queued],
      [reviewState(begin.pages, { run: { phase: 'locating', total: 2, finished: 1 } }), queued],
      [reviewState(begin.pages, { run: { phase: 'correcting', total: 2, finished: 0 } }), queued],
      [
        reviewState(
          { a: reviewed('a'), b: waiting },
          { run: { phase: 'correcting', total: 2, finished: 1 } },
        ),
        queued,
      ],
      [
        reviewState(
          { a: reviewed('a'), b: reviewed('b') },
          { run: { phase: 'correcting', total: 2, finished: 2 } },
        ),
        queued,
      ],
    ];
    const progress = steps.map(([review, count]) =>
      runProgress(review, count, IDLE_ENGINE, 0, start),
    );
    const values = progress.map((step) => step?.value ?? -1);
    expect(values[0]).toBe(0);
    expect(new Set(values).size).toBe(values.length - 1);
    expect(values.at(-1)).toBe(100);
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] ?? 0);
    }
    expect(progress.map((step) => step?.label)).toEqual(values.map((value) => `${value}\u00a0%`));
    expect(progress.every((step) => step?.max === 100 && step.detail === null)).toBe(true);
  });

  it('leaves out pages outside the run', () => {
    const pages = { a: waiting, b: waiting, old: reviewed('alt') };
    const begin = reviewState(pages, { run: { phase: 'transcribing', total: 2, finished: 0 } });
    const start = startRun(begin, runState({}), 0);
    expect(start.pageIds).toEqual(['a', 'b']);
    const halfRead = runState({ a: pending('done'), old: pending('done') });
    expect(runProgress(begin, halfRead, IDLE_ENGINE, 0, start)?.label).toBe('30\u00a0%');
  });

  it('estimates the remaining time from the progress made since the start', () => {
    const begin = reviewState(
      { a: waiting, b: waiting },
      { run: { phase: 'transcribing', total: 2, finished: 0 } },
    );
    const start = startRun(begin, runState({ a: pending('waiting'), b: pending('waiting') }), 0);
    expect(
      runProgress(begin, runState({ a: pending('running') }), IDLE_ENGINE, 30_000, start)?.detail,
    ).toBeNull();
    const halfTranscribed = runState({ a: pending('done'), b: pending('running') });
    expect(runProgress(begin, halfTranscribed, IDLE_ENGINE, 60_000, start)?.detail).toBe(
      'noch etwa 3 Minuten',
    );
  });

  it('waits for real progress before estimating a run whose pages were already read', () => {
    const transcribed = runState({ a: pending('done'), b: pending('done') });
    const begin = reviewState(
      { a: waiting, b: waiting },
      { run: { phase: 'transcribing', total: 0, finished: 0 } },
    );
    const start = startRun(begin, transcribed, 0);
    expect(start.fraction).toBeCloseTo(0.6);
    const locating = reviewState(begin.pages, {
      run: { phase: 'locating', total: 2, finished: 0 },
    });
    expect(runProgress(locating, transcribed, IDLE_ENGINE, 5_000, start)?.detail).toBeNull();
  });

  it('only mentions the model while loading or switching it holds the run up', () => {
    const correcting = reviewState(
      { a: waiting },
      { run: { phase: 'correcting', total: 1, finished: 0 } },
    );
    const start = startRun(correcting, runState({}), 0);
    const detail = (engine: ReviewEngine) =>
      runProgress(correcting, runState({}), engine, 0, start)?.detail;
    expect(detail({ transcriber: 'idle', corrector: 'starting' })).toBe('Modell wird geladen …');
    expect(detail({ transcriber: 'ready', corrector: 'idle' })).toBe('Modell wird geladen …');
    expect(detail({ transcriber: 'idle', corrector: 'ready' })).toBeNull();
  });

  it('shows the cancellation without progress', () => {
    const stopping = reviewState(
      {},
      { run: { phase: 'correcting', total: 2, finished: 1 }, stopping: true },
    );
    expect(runProgress(stopping, runState({}), IDLE_ENGINE, 0)).toMatchObject({
      label: 'Wird abgebrochen …',
      value: null,
    });
  });
});

describe('finished texts', () => {
  const arbeiten: Arbeit[] = [{ id: 'x', name: 'Aufsatz', pages: [page('a'), page('b')] }];

  it('sums the counted words and names unrecognised pages', () => {
    expect(
      countFinishedText(
        arbeiten,
        runState({ a: entry('eins zwei drei'), b: entry('vier fünf sechs') }),
      ),
    ).toBe('Fertig: 6 Wörter auf 2 Seiten.');
    const failed = entry('', {
      status: 'error',
      hasTranscript: false,
      error: { kind: 'failed', message: 'x' },
    });
    expect(countFinishedText(arbeiten, runState({ a: failed, b: failed }))).toBe(
      'Fertig: 0 Wörter auf 0 Seiten. 2 Seiten nicht erkannt.',
    );
  });

  it('counts corrected pages and pages with errors', () => {
    const count = runState({ a: entry('eins'), b: entry('zwei') });
    const review = reviewState({ a: reviewed('eins'), b: reviewed('zwei', { status: 'failed' }) });
    expect(reviewFinishedText(arbeiten, review, count)).toBe(
      'Fertig: 1 von 2 Seiten korrigiert. 1 Seite mit Fehlern.',
    );
  });
});

function memory(): KindStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('run kind storage', () => {
  it('defaults to correcting and remembers the last choice', () => {
    const storage = memory();
    expect(loadRunKind(storage)).toBe('correct');
    saveRunKind('count', storage);
    expect(storage.values.get(RUN_KIND_STORAGE_KEY)).toBe('count');
    expect(loadRunKind(storage)).toBe('count');
  });

  it('keeps working without a usable storage', () => {
    const broken: KindStorage = {
      getItem: () => {
        throw new Error('gesperrt');
      },
      setItem: () => {
        throw new Error('gesperrt');
      },
    };
    expect(loadRunKind(broken)).toBe('correct');
    expect(() => saveRunKind('count', broken)).not.toThrow();
    expect(loadRunKind(null)).toBe('correct');
  });
});

describe('progress of the content review phase', () => {
  const done = reviewed('text');
  const pageIds = ['a', 'b'];
  const finishedCount = runState({ a: pending('done'), b: pending('done') });

  function inRun(
    phase: ReviewPhase,
    total: number,
    finished: number,
    stages?: RunStages,
  ): ReviewState {
    return reviewState(
      { a: done, b: done },
      { run: { phase, total, finished, ...(stages !== undefined && { stages }) } },
    );
  }

  const withReview: RunStages = { pages: true, review: true };
  const reviewOnly: RunStages = { pages: false, review: true };

  const fraction = (phase: ReviewPhase, total: number, finished: number) =>
    reviewFraction(inRun(phase, total, finished, withReview), finishedCount, pageIds);

  const onlyReview = (total: number, finished: number) =>
    reviewFraction(inRun('reviewing', total, finished, reviewOnly), finishedCount, []);

  it('gives the review the last 15 percent of a run that also corrects pages', () => {
    expect(fraction('correcting', 2, 0)).toBeCloseTo(0.5525);
    expect(fraction('correcting', 2, 2)).toBeCloseTo(0.85);
    expect(fraction('reviewing', 4, 0)).toBeCloseTo(0.85);
    expect(fraction('reviewing', 4, 2)).toBeCloseTo(0.925);
    expect(fraction('reviewing', 4, 4)).toBeCloseTo(1);
  });

  it('scales the page phases down only when a review follows', () => {
    const plain = reviewFraction(
      inRun('correcting', 2, 2, { pages: true, review: false }),
      finishedCount,
      pageIds,
    );
    const legacy = reviewFraction(inRun('correcting', 2, 2), finishedCount, pageIds);
    expect(plain).toBeCloseTo(1);
    expect(legacy).toBeCloseTo(1);
  });

  it('never moves backwards over all phases of a run with review', () => {
    const steps: [ReviewPhase, number, number][] = [
      ['locating', 2, 0],
      ['locating', 2, 2],
      ['correcting', 2, 0],
      ['correcting', 2, 1],
      ['correcting', 2, 2],
      ['reviewing', 3, 0],
      ['reviewing', 3, 1],
      ['reviewing', 3, 3],
    ];
    const values = steps.map(([phase, total, finished]) =>
      reviewFraction(inRun(phase, total, finished, withReview), finishedCount, pageIds),
    );
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] ?? 0);
    }
    expect(values.at(-1)).toBeCloseTo(1);
  });

  it('counts the transcription of pages within the first part of a run with review', () => {
    const halfRead = runState({ a: pending('done'), b: pending('running') });
    const begin = inRun('transcribing', 2, 1, withReview);
    expect(reviewFraction(begin, halfRead, pageIds)).toBeCloseTo(0.6 * 0.85 * 0.5);
  });

  it('lets a review-only run fill the whole bar', () => {
    expect(onlyReview(4, 0)).toBe(0);
    expect(onlyReview(4, 1)).toBeCloseTo(0.25);
    expect(onlyReview(4, 4)).toBe(1);
  });

  it('treats an empty review phase as complete', () => {
    expect(
      reviewFraction(inRun('reviewing', 0, 0, withReview), finishedCount, pageIds),
    ).toBeCloseTo(1);
    expect(onlyReview(0, 0)).toBe(1);
  });

  it('caps the share when more works finished than were planned', () => {
    expect(onlyReview(2, 5)).toBe(1);
  });

  it('is zero without a run', () => {
    expect(reviewFraction(reviewState({}), finishedCount, pageIds)).toBe(0);
  });

  it('shows the percentage of a review-only run and estimates its time', () => {
    const begin = inRun('reviewing', 4, 0, reviewOnly);
    const start = startRun(begin, finishedCount, 0);
    expect(start).toEqual({ pageIds: [], at: 0, fraction: 0 });

    const quarter = inRun('reviewing', 4, 1, reviewOnly);
    expect(runProgress(quarter, finishedCount, IDLE_ENGINE, 10_000, start)).toEqual({
      label: '25\u00a0%',
      detail: 'noch etwa 30 Sekunden',
      value: 25,
      max: 100,
    });
    expect(runProgress(begin, finishedCount, IDLE_ENGINE, 10_000, start)?.detail).toBeNull();
  });

  it('shows the percentage of the review part within a run that also corrects pages', () => {
    const correcting = inRun('correcting', 2, 0, withReview);
    const start = startRun(correcting, finishedCount, 0);
    const halfReviewed = inRun('reviewing', 2, 1, withReview);
    expect(runProgress(halfReviewed, finishedCount, IDLE_ENGINE, 0, start)).toMatchObject({
      label: '93\u00a0%',
      value: 93,
      max: 100,
    });
  });

  it('mentions the corrector model while the review waits for it', () => {
    const reviewing = inRun('reviewing', 1, 0, reviewOnly);
    const start = startRun(reviewing, finishedCount, 0);
    const detail = (engine: ReviewEngine) =>
      runProgress(reviewing, finishedCount, engine, 0, start)?.detail;

    expect(detail({ transcriber: 'idle', corrector: 'starting' })).toBe('Modell wird geladen …');
    expect(detail({ transcriber: 'ready', corrector: 'idle' })).toBe('Modell wird geladen …');
    expect(detail({ transcriber: 'idle', corrector: 'ready' })).toBeNull();
  });

  it('shows the cancellation during the review phase without progress', () => {
    const stopping = reviewState(
      {},
      {
        run: { phase: 'reviewing', total: 2, finished: 1, stages: reviewOnly },
        stopping: true,
      },
    );
    expect(runProgress(stopping, runState({}), IDLE_ENGINE, 0)).toMatchObject({
      label: 'Wird abgebrochen …',
      value: null,
    });
  });
});
