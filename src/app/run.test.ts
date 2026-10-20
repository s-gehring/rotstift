import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { PageEntry, RunState } from '../pipeline/runner.ts';
import { IDLE_ENGINE } from '../review/engine-phase.ts';
import type { ReviewPage, ReviewState } from '../review/review-flow.ts';
import { page } from '../review/test-support.ts';
import {
  countFinishedText,
  loadRunKind,
  openPageCount,
  readiness,
  reviewFinishedText,
  RUN_KIND_STORAGE_KEY,
  runProgress,
  saveRunKind,
  startDecision,
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
  return { pages, profile: DEUTSCH, run: null, stopping: false, outcome: null, ...overrides };
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

describe('runProgress', () => {
  it('shows nothing while idle', () => {
    expect(runProgress(EMPTY_REVIEW, runState({}), IDLE_ENGINE, 0)).toBeNull();
  });

  it('shows the counted page and says when the recognition starts', () => {
    const counting = runState({}, { batch: { total: 3, finished: 1 } });
    expect(runProgress(EMPTY_REVIEW, counting, IDLE_ENGINE, 0)).toEqual({
      label: 'Seite 2 von 3',
      detail: null,
      value: 1,
      max: 3,
    });
    expect(
      runProgress(EMPTY_REVIEW, counting, { transcriber: 'starting', corrector: 'idle' }, 0)
        ?.detail,
    ).toBe('Texterkennung startet …');
  });

  it('estimates the remaining time once a page has been measured', () => {
    const counting = runState(
      {},
      { batch: { total: 3, finished: 1 }, durationsMs: [30_000], runningSince: 0 },
    );
    expect(runProgress(EMPTY_REVIEW, counting, IDLE_ENGINE, 0)?.detail).toBe('noch etwa 1 Minute');
  });

  it('names the phase of a correction run and the engine that is loading', () => {
    const transcribing = reviewState({}, { run: { phase: 'transcribing', total: 4, finished: 0 } });
    expect(runProgress(transcribing, runState({}), IDLE_ENGINE, 0)).toEqual({
      label: 'Seite 1 von 4',
      detail: 'Texterkennung',
      value: 0,
      max: 4,
    });
    const correcting = reviewState({}, { run: { phase: 'correcting', total: 4, finished: 2 } });
    expect(
      runProgress(correcting, runState({}), { transcriber: 'idle', corrector: 'starting' }, 0)
        ?.detail,
    ).toBe('Korrektur · Korrekturmodell wird geladen …');
    expect(
      runProgress(correcting, runState({}), { transcriber: 'ready', corrector: 'idle' }, 0)?.detail,
    ).toBe('Korrektur · Modellwechsel wird vorbereitet …');
  });

  it('shows an indeterminate phase without page count and the cancellation', () => {
    const locating = reviewState({}, { run: { phase: 'locating', total: 0, finished: 0 } });
    expect(runProgress(locating, runState({}), IDLE_ENGINE, 0)).toMatchObject({
      label: 'Zeilen suchen …',
      value: null,
    });
    const stopping = reviewState(
      {},
      { run: { phase: 'correcting', total: 2, finished: 1 }, stopping: true },
    );
    expect(runProgress(stopping, runState({}), IDLE_ENGINE, 0)?.label).toBe('Wird abgebrochen …');
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
