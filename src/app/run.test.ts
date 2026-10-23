import { describe, expect, it, vi } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../correction/scope.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { PageEntry, RunState } from '../pipeline/runner.ts';
import { IDLE_ENGINE, type ReviewEngine } from '../review/engine-phase.ts';
import type { ReviewPage, ReviewPhase, ReviewState, RunStages } from '../review/review-flow.ts';
import { page } from '../review/test-support.ts';
import { createEstimator, DEFAULT_RATES } from './estimate.ts';
import {
  countFinishedText,
  createPowerHold,
  loadRunKind,
  neededRoles,
  openPageCount,
  readiness,
  reviewFinishedText,
  RUN_KIND_STORAGE_KEY,
  reviewFraction,
  runProgress,
  runSnapshot,
  saveRunKind,
  startDecision,
  startRun,
  startWorkload,
  type KindStorage,
  type Readiness,
} from './run.ts';
import type { ModelRole } from './types.ts';

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
          preview: true,
        },
        null,
      ),
    ).toBe('ready');
    expect(readiness({ state: 'needs-model', problem: 'verifying' }, null)).toBe('missing');
    expect(readiness({ state: 'needs-model', message: 'fehlt' }, null)).toBe('missing');
    expect(readiness({ state: 'unavailable', message: 'nur Desktop' }, null)).toBe('unavailable');
  });
});

const CONTENT_SCOPE: CorrectionScope = {
  ...DEFAULT_SCOPE,
  content: true,
  assignment: 'Beschreibe deinen Tag.',
};

const FORM_ONLY: CorrectionScope = {
  ...DEFAULT_SCOPE,
  spelling: false,
  grammar: false,
  form: true,
  formName: 'Persönlicher Brief',
};

const roles = (
  transcriber: Readiness,
  corrector: Readiness,
  reviewer: Readiness = 'ready',
): Record<ModelRole, Readiness> => ({ transcriber, corrector, reviewer });

describe('neededRoles', () => {
  it('needs the corrector only for spelling or grammar and the reviewer only for content or form', () => {
    expect(neededRoles('count', CONTENT_SCOPE)).toEqual(['transcriber']);
    expect(neededRoles('correct', DEFAULT_SCOPE)).toEqual(['transcriber', 'corrector']);
    expect(neededRoles('correct', { ...DEFAULT_SCOPE, grammar: false })).toEqual([
      'transcriber',
      'corrector',
    ]);
    expect(neededRoles('correct', CONTENT_SCOPE)).toEqual(['transcriber', 'corrector', 'reviewer']);
    expect(neededRoles('correct', FORM_ONLY)).toEqual(['transcriber', 'reviewer']);
  });

  it('does not need the reviewer while the assignment or the form is still missing', () => {
    expect(neededRoles('correct', { ...CONTENT_SCOPE, assignment: '' })).toEqual([
      'transcriber',
      'corrector',
    ]);
    expect(neededRoles('correct', { ...FORM_ONLY, formName: '' })).toEqual(['transcriber']);
  });
});

describe('startDecision', () => {
  it('starts when every needed model is ready', () => {
    expect(startDecision('count', roles('ready', 'missing', 'missing'))).toEqual({
      action: 'launch',
    });
    expect(startDecision('correct', roles('ready', 'ready', 'missing'))).toEqual({
      action: 'launch',
    });
    expect(startDecision('correct', roles('ready', 'ready'), CONTENT_SCOPE)).toEqual({
      action: 'launch',
    });
  });

  it('opens the setup for exactly the models the chosen kind is missing', () => {
    expect(startDecision('correct', roles('ready', 'missing'))).toEqual({
      action: 'setup',
      roles: ['corrector'],
    });
    expect(startDecision('correct', roles('missing', 'missing'))).toEqual({
      action: 'setup',
      roles: ['transcriber', 'corrector'],
    });
    expect(startDecision('count', roles('missing', 'missing', 'missing'))).toEqual({
      action: 'setup',
      roles: ['transcriber'],
    });
  });

  it('asks for the reviewer only when the scope reviews content or form', () => {
    expect(startDecision('correct', roles('ready', 'ready', 'missing'), CONTENT_SCOPE)).toEqual({
      action: 'setup',
      roles: ['reviewer'],
    });
    expect(startDecision('correct', roles('ready', 'missing', 'missing'), CONTENT_SCOPE)).toEqual({
      action: 'setup',
      roles: ['corrector', 'reviewer'],
    });
    expect(startDecision('correct', roles('ready', 'missing', 'missing'), FORM_ONLY)).toEqual({
      action: 'setup',
      roles: ['reviewer'],
    });
    expect(startDecision('correct', roles('ready', 'missing', 'ready'), FORM_ONLY)).toEqual({
      action: 'launch',
    });
  });

  it('waits while a model is still being checked and refuses outside the desktop app', () => {
    expect(startDecision('count', roles('checking', 'ready'))).toEqual({ action: 'wait' });
    expect(startDecision('correct', roles('ready', 'ready', 'checking'), CONTENT_SCOPE)).toEqual({
      action: 'wait',
    });
    expect(startDecision('correct', roles('ready', 'unavailable'))).toEqual({
      action: 'unavailable',
    });
    expect(startDecision('correct', roles('ready', 'ready', 'unavailable'), FORM_ONLY)).toEqual({
      action: 'unavailable',
    });
    expect(startDecision('correct', roles('ready', 'unavailable', 'ready'), FORM_ONLY)).toEqual({
      action: 'launch',
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

const withSecond = (entries: Record<string, PageEntry>) =>
  runState(entries, { secondReading: true });

const awaiting = (status: PageEntry['status'] = 'done') =>
  entry('', { status, awaitingSecond: true });

describe('runProgress', () => {
  const waiting = reviewed(null, { status: 'waiting' });

  it('shows nothing while idle', () => {
    expect(runProgress(EMPTY_REVIEW, runState({}), IDLE_ENGINE, 0)).toBeNull();
  });

  it('counts finished pages while counting words and says when the model loads', () => {
    const counting = runState({}, { batch: { total: 2, finished: 1 } });
    expect(runProgress(EMPTY_REVIEW, counting, IDLE_ENGINE, 0)).toEqual({
      label: 'Seite 1 von 2',
      detail: null,
      value: 1,
      max: 2,
    });
    expect(
      runProgress(EMPTY_REVIEW, counting, { transcriber: 'starting', corrector: 'idle' }, 0)
        ?.detail,
    ).toBe('Modell wird geladen …');
  });

  it('estimates the remaining time of counting from the rule of thumb or the measured rate', () => {
    const counting = runState({}, { batch: { total: 3, finished: 1 } });
    expect(runProgress(EMPTY_REVIEW, counting, IDLE_ENGINE, 0)?.detail).toBe('noch etwa 1 min');
    const slow = createEstimator({ ...DEFAULT_RATES, read: 90 });
    expect(runProgress(EMPTY_REVIEW, counting, IDLE_ENGINE, 0, null, slow)?.detail).toBe(
      'noch etwa 3 min',
    );
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
    expect(progress.every((step) => step?.max === 100)).toBe(true);
  });

  it('leaves out pages outside the run', () => {
    const pages = { a: waiting, b: waiting, old: reviewed('alt') };
    const begin = reviewState(pages, { run: { phase: 'transcribing', total: 2, finished: 0 } });
    const start = startRun(begin, runState({}), 0);
    expect(start.pageIds).toEqual(['a', 'b']);
    const halfRead = runState({ a: pending('done'), old: pending('done') });
    expect(runProgress(begin, halfRead, IDLE_ENGINE, 0, start)?.label).toBe('30\u00a0%');
  });

  describe('with a second reading', () => {
    const begin = reviewState(
      { a: waiting, b: waiting },
      { run: { phase: 'transcribing', total: 2, finished: 0 } },
    );

    it('counts every reading pass of every page towards the first part of the bar', () => {
      const start = startRun(
        begin,
        withSecond({ a: pending('waiting'), b: pending('waiting') }),
        0,
      );
      const fraction = (entries: Record<string, PageEntry>) =>
        reviewFraction(begin, withSecond(entries), start.pageIds) / 0.6;
      expect(fraction({ a: pending('waiting'), b: pending('waiting') })).toBe(0);
      expect(fraction({ a: awaiting(), b: pending('running') })).toBeCloseTo(1 / 4);
      expect(fraction({ a: awaiting(), b: awaiting() })).toBeCloseTo(2 / 4);
      expect(fraction({ a: entry('x'), b: awaiting() })).toBeCloseTo(3 / 4);
      expect(fraction({ a: entry('x'), b: entry('y') })).toBe(1);
    });

    it('does not wait for a second reading of pages that failed', () => {
      const entries = { a: entry('x'), b: pending('error') };
      expect(reviewFraction(begin, withSecond(entries), ['a', 'b']) / 0.6).toBe(1);
    });

    it('prices the second reading as its own step once every page is read once', () => {
      const queued = withSecond({ a: pending('waiting'), b: pending('waiting') });
      const start = startRun(begin, queued, 0);
      expect(runSnapshot(begin, queued, start)).toMatchObject({
        step: 'read',
        left: { read: 2, confirm: 2 },
      });
      const confirming = withSecond({ a: awaiting(), b: awaiting() });
      expect(runSnapshot(begin, confirming, start)).toMatchObject({
        step: 'confirm',
        left: { read: 0, confirm: 2 },
      });
      const almost = withSecond({ a: entry('x'), b: awaiting() });
      expect(runSnapshot(begin, almost, start)).toMatchObject({
        step: 'confirm',
        left: { read: 0, confirm: 1 },
      });
    });

    it('keeps counting the second readings while counting words', () => {
      const counting = withSecond({ a: awaiting(), b: awaiting() });
      const batch = { ...counting, batch: { total: 2, finished: 2 } };
      expect(runSnapshot(EMPTY_REVIEW, batch, null)).toMatchObject({
        step: 'confirm',
        left: { read: 0, confirm: 2 },
      });
      expect(runProgress(EMPTY_REVIEW, batch, IDLE_ENGINE, 0)?.detail).toBe('noch etwa 1 min');
    });
  });

  it('starts from the rule of thumb for the steps of the run', () => {
    const queued = runState({ a: pending('waiting'), b: pending('waiting') });
    const begin = reviewState(
      { a: waiting, b: waiting },
      { run: { phase: 'transcribing', total: 2, finished: 0 } },
    );
    const start = startRun(begin, queued, 0);
    expect(runProgress(begin, queued, IDLE_ENGINE, 0, start)?.detail).toBe('noch etwa 2 min');
    const halfTranscribed = runState({ a: pending('done'), b: pending('running') });
    expect(runProgress(begin, halfTranscribed, IDLE_ENGINE, 0, start)?.detail).toBe(
      'noch etwa 1 min',
    );
  });

  const run = (stages: RunStages) =>
    reviewState(
      { a: waiting, b: waiting },
      { run: { phase: 'transcribing', total: 2, finished: 0, stages } },
    );

  it('adds the content review of the arbeiten to the estimate when it is chosen', () => {
    const queued = runState({ a: pending('waiting'), b: pending('waiting') });
    const arbeiten = [{ pages: [{ id: 'a' }] }, { pages: [{ id: 'b' }] }];
    const estimate = (stages: RunStages) => {
      const begin = run(stages);
      return runProgress(begin, queued, IDLE_ENGINE, 0, startRun(begin, queued, 0, arbeiten))
        ?.detail;
    };
    expect(estimate({ pages: true, review: false })).toBe('noch etwa 2 min');
    const slowReview = createEstimator({ ...DEFAULT_RATES, review: 120 });
    const begin = run({ pages: true, review: true });
    const start = startRun(begin, queued, 0, arbeiten);
    expect(runProgress(begin, queued, IDLE_ENGINE, 0, start, slowReview)?.detail).toBe(
      'noch etwa 6 min',
    );
  });

  it('shows no estimate for a run whose pages were already read and corrected soon', () => {
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
    expect(start).toEqual({ pageIds: [], works: 0, at: 0, fraction: 0 });

    const quarter = inRun('reviewing', 4, 1, reviewOnly);
    expect(runProgress(quarter, finishedCount, IDLE_ENGINE, 10_000, start)).toEqual({
      label: '25\u00a0%',
      detail: 'noch etwa 1 min',
      value: 25,
      max: 100,
    });
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

describe('startWorkload', () => {
  const pages = [page('a'), page('b'), page('c')];
  const arbeiten = [{ pages: [pages[0]!, pages[1]!] }, { pages: [pages[2]!] }];
  const content: CorrectionScope = {
    ...DEFAULT_SCOPE,
    content: true,
    assignment: 'Beschreibe deinen Tag.',
  };
  const plain: CorrectionScope = { ...DEFAULT_SCOPE, spelling: true, content: false };
  const work = (kind: 'count' | 'correct', count: RunState, scope: CorrectionScope) =>
    startWorkload(kind, pages, arbeiten, count, reviewState({}), DEUTSCH, scope);

  it('counts only the reading for the word count', () => {
    expect(work('count', runState({}), plain)).toEqual({
      read: 3,
      confirm: 0,
      correct: 0,
      review: 0,
    });
  });

  it('adds correcting and reviewing for the chosen scope', () => {
    expect(work('correct', runState({}), plain)).toEqual({
      read: 3,
      confirm: 0,
      correct: 3,
      review: 0,
    });
    expect(work('correct', runState({}), content).review).toBe(2);
  });

  it('leaves out pages that are already read', () => {
    const count = runState({ a: entry('x'), b: entry('y') });
    expect(work('correct', count, plain)).toEqual({ read: 1, confirm: 0, correct: 3, review: 0 });
  });

  it('adds one second reading for every page that still has to be read', () => {
    const count = runState({ a: entry('x') });
    const secondly = startWorkload(
      'correct',
      pages,
      arbeiten,
      count,
      reviewState({}),
      DEUTSCH,
      plain,
      true,
    );
    expect(secondly).toEqual({ read: 2, confirm: 2, correct: 3, review: 0 });
  });
});

function recorder() {
  const calls: string[] = [];
  const invoke = (command: string) => {
    calls.push(command);
    return Promise.resolve();
  };
  return { calls, invoke };
}

describe('createPowerHold', () => {
  it('holds when a run starts and releases when it ends', async () => {
    const { calls, invoke } = recorder();
    const power = createPowerHold(invoke);
    power.set(true);
    power.set(false);
    await vi.waitFor(() => expect(calls).toEqual(['power_hold', 'power_release']));
  });

  it('does not repeat a command while the state is unchanged', async () => {
    const { calls, invoke } = recorder();
    const power = createPowerHold(invoke);
    power.set(false);
    power.set(true);
    power.set(true);
    await vi.waitFor(() => expect(calls).toEqual(['power_hold']));
  });

  it('releases after a failed run just as after a finished one', async () => {
    const { calls, invoke } = recorder();
    const power = createPowerHold(invoke);
    power.set(true);
    power.set(false);
    power.set(true);
    power.set(false);
    await vi.waitFor(() =>
      expect(calls).toEqual(['power_hold', 'power_release', 'power_hold', 'power_release']),
    );
  });

  it('keeps the commands in order when the first one is slow', async () => {
    const calls: string[] = [];
    const invoke = (command: string) => {
      calls.push(command);
      return command === 'power_hold'
        ? new Promise<void>((resolve) => setTimeout(resolve, 30))
        : Promise.resolve();
    };
    const power = createPowerHold(invoke);
    power.set(true);
    power.set(false);
    await Promise.resolve();
    expect(calls).toEqual(['power_hold']);
    await vi.waitFor(() => expect(calls).toEqual(['power_hold', 'power_release']));
  });

  it('survives a rejected command and keeps working', async () => {
    const calls: string[] = [];
    const invoke = (command: string) => {
      calls.push(command);
      return calls.length === 1 ? Promise.reject(new Error('no backend')) : Promise.resolve();
    };
    const power = createPowerHold(invoke);
    power.set(true);
    power.set(false);
    await vi.waitFor(() => expect(calls).toEqual(['power_hold', 'power_release']));
  });
});

describe('runs that wait for the release of protected works', () => {
  const waiting = reviewed(null, { status: 'waiting' });
  const pages = { a: waiting, b: waiting };
  const queued = runState({ a: entry('A'), b: entry('B') });
  const protectedRun = (
    phase: ReviewPhase,
    finished: number,
    left: { confirm: number; correct: number; review: number },
  ) =>
    reviewState(pages, {
      run: { phase, total: 2, finished, pending: { ...left, withCorrection: true } },
    });

  it('shows the wait for the teacher as its own state and not as remaining time', () => {
    const paused = protectedRun('awaiting', 0, { confirm: 2, correct: 2, review: 0 });
    expect(runSnapshot(paused, queued, null)).toBeNull();
    expect(runProgress(paused, queued, IDLE_ENGINE, 0)).toMatchObject({
      detail: 'Wartet auf Freigabe (2 Arbeiten)',
    });
    const slow = createEstimator({ ...DEFAULT_RATES, correct: 60 });
    expect(runProgress(paused, queued, IDLE_ENGINE, 0, null, slow)?.detail).toBe(
      'Wartet auf Freigabe (2 Arbeiten), danach etwa 2 min',
    );
  });

  it('says that personal data is being detected', () => {
    const detecting = protectedRun('detecting', 0, { confirm: 2, correct: 2, review: 0 });
    expect(runProgress(detecting, queued, IDLE_ENGINE, 0)?.detail).toBe(
      'Personenbezug wird erkannt …',
    );
    expect(runSnapshot(detecting, queued, null)).toBeNull();
  });

  it('counts the remaining protected work while a released work is corrected', () => {
    const correcting = protectedRun('correcting', 1, { confirm: 1, correct: 1, review: 2 });
    expect(runSnapshot(correcting, queued, null)).toEqual({
      step: 'correct',
      left: { read: 0, confirm: 0, correct: 1, review: 2 },
    });
    const reviewing = protectedRun('reviewing', 1, { confirm: 0, correct: 0, review: 1 });
    expect(runSnapshot(reviewing, queued, null)?.step).toBe('review');
  });

  it('fills the bar from the end of the local steps on', () => {
    const fractions = [0, 1, 2].map((finished) =>
      reviewFraction(
        protectedRun('awaiting', finished, { confirm: 1, correct: 2 - finished, review: 0 }),
        queued,
        ['a', 'b'],
      ),
    );
    expect(fractions[0]).toBeCloseTo(0.65);
    expect(fractions[1]).toBeCloseTo(0.825);
    expect(fractions[2]).toBeCloseTo(1);
  });
});
