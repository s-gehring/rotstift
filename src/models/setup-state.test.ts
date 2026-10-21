import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID, DEFAULT_REVIEWER_ID, recommendModel, REVIEWERS } from './registry.ts';
import {
  ANY_MODEL,
  activeModel,
  errorOf,
  hasRunningJob,
  INITIAL_SETUP,
  samplesOf,
  setupReducer,
  type SetupState,
} from './setup-state.ts';
import type { ModelStatus } from './types.ts';

const model = recommendModel();
const STRONGER = 'qwen3-vl-4b-q4';
const GIB = 1024 ** 3;
const missing: ModelStatus = {
  modelId: model.id,
  state: 'missing',
  downloadedBytes: 0,
  totalBytes: 1000,
};

const progress = (modelId: string, at: number, bytes: number) =>
  ({
    type: 'event',
    at,
    event: { modelId, state: 'progress', downloadedBytes: bytes, totalBytes: 1000 },
  }) as const;

function loaded(status: ModelStatus = missing): SetupState {
  return setupReducer(INITIAL_SETUP, { type: 'loaded', statuses: [status], hardware: null });
}

describe('the reviewer choice', () => {
  it('falls back to the default reviewer and keeps a ready selection', () => {
    expect(activeModel(INITIAL_SETUP, REVIEWERS).id).toBe(DEFAULT_REVIEWER_ID);
    const status: ModelStatus = {
      modelId: DEFAULT_REVIEWER_ID,
      state: 'ready',
      downloadedBytes: 1000,
      totalBytes: 1000,
    };
    const state = setupReducer(INITIAL_SETUP, {
      type: 'loaded',
      statuses: [status],
      hardware: { totalRamBytes: 8 * GIB, freeDiskBytes: null },
      selectedId: DEFAULT_REVIEWER_ID,
    });
    expect(state.selectedId).toBe(DEFAULT_REVIEWER_ID);
    expect(activeModel(state, REVIEWERS).id).toBe(DEFAULT_REVIEWER_ID);
  });
});

describe('setupReducer', () => {
  it('tracks progress, speed samples and completion', () => {
    let state = loaded();
    state = setupReducer(state, {
      type: 'event',
      at: 100,
      event: { modelId: model.id, state: 'progress', downloadedBytes: 400, totalBytes: 1000 },
    });
    expect(state.statuses[model.id]).toMatchObject({ state: 'downloading', downloadedBytes: 400 });
    expect(samplesOf(state, model.id)).toEqual([{ at: 100, bytes: 400 }]);

    state = setupReducer(state, {
      type: 'event',
      at: 200,
      event: { modelId: model.id, state: 'done' },
    });
    expect(state.statuses[model.id]).toMatchObject({ state: 'ready', downloadedBytes: 1000 });
    expect(samplesOf(state, model.id)).toEqual([]);
  });

  it('returns to missing after cancel and keeps the error after a failure', () => {
    const downloading = setupReducer(loaded(), {
      type: 'event',
      at: 1,
      event: { modelId: model.id, state: 'progress', downloadedBytes: 10, totalBytes: 1000 },
    });
    const cancelled = setupReducer(downloading, {
      type: 'event',
      at: 2,
      event: { modelId: model.id, state: 'cancelled' },
    });
    expect(cancelled.statuses[model.id]?.state).toBe('missing');

    const failed = setupReducer(downloading, {
      type: 'event',
      at: 2,
      event: { modelId: model.id, state: 'failed', error: { kind: 'incomplete' } },
    });
    expect(failed.statuses[model.id]?.state).toBe('missing');
    expect(errorOf(failed, model.id)).toEqual({ kind: 'incomplete' });
  });

  it('uses the default model until a model is chosen', () => {
    expect(activeModel(INITIAL_SETUP).id).toBe(DEFAULT_MODEL_ID);
    expect(activeModel(loaded({ ...missing, state: 'ready' })).id).toBe(DEFAULT_MODEL_ID);
  });

  it('uses the chosen model, also while it is not installed', () => {
    const state = setupReducer(INITIAL_SETUP, {
      type: 'loaded',
      statuses: [missing],
      hardware: { totalRamBytes: 32 * GIB, freeDiskBytes: null },
      selectedId: STRONGER,
    });
    expect(state.selectedId).toBe(STRONGER);
    expect(activeModel(state).id).toBe(STRONGER);
    const switched = setupReducer(state, { type: 'selected', modelId: DEFAULT_MODEL_ID });
    expect(activeModel(switched).id).toBe(DEFAULT_MODEL_ID);
  });

  it('falls back to the default for unknown choices and machines that are too small', () => {
    const unknown = setupReducer(INITIAL_SETUP, {
      type: 'loaded',
      statuses: [],
      hardware: null,
      selectedId: 'removed-model',
    });
    expect(activeModel(unknown).id).toBe(DEFAULT_MODEL_ID);
    const small = setupReducer(INITIAL_SETUP, {
      type: 'loaded',
      statuses: [],
      hardware: { totalRamBytes: 8 * GIB, freeDiskBytes: null },
      selectedId: STRONGER,
    });
    expect(activeModel(small).id).toBe(DEFAULT_MODEL_ID);
  });

  it('keeps the choice when a later refresh does not report one', () => {
    const chosen = setupReducer(INITIAL_SETUP, { type: 'selected', modelId: STRONGER });
    const refreshed = setupReducer(chosen, { type: 'loaded', statuses: [], hardware: null });
    expect(refreshed.selectedId).toBe(STRONGER);
    const cleared = setupReducer(chosen, {
      type: 'loaded',
      statuses: [],
      hardware: null,
      selectedId: null,
    });
    expect(cleared.selectedId).toBeNull();
  });

  it('keeps speed samples and errors apart per model', () => {
    const both = setupReducer(loaded(), {
      type: 'loaded',
      statuses: [{ ...missing, modelId: STRONGER }],
      hardware: null,
    });
    let state = setupReducer(both, progress(STRONGER, 10, 100));
    state = setupReducer(state, progress(model.id, 20, 50));
    state = setupReducer(state, progress(STRONGER, 30, 300));
    expect(samplesOf(state, STRONGER)).toEqual([
      { at: 10, bytes: 100 },
      { at: 30, bytes: 300 },
    ]);
    expect(samplesOf(state, model.id)).toEqual([{ at: 20, bytes: 50 }]);

    state = setupReducer(state, {
      type: 'event',
      at: 40,
      event: { modelId: STRONGER, state: 'failed', error: { kind: 'network' } },
    });
    expect(errorOf(state, STRONGER)).toEqual({ kind: 'network' });
    expect(errorOf(state, model.id)).toBeNull();
    expect(samplesOf(state, STRONGER)).toEqual([]);
    expect(samplesOf(state, model.id)).toHaveLength(1);

    state = setupReducer(state, { type: 'error', modelId: STRONGER, error: null });
    expect(errorOf(state, STRONGER)).toBeNull();
  });

  it('shows a general error for every model', () => {
    const state = setupReducer(INITIAL_SETUP, {
      type: 'error',
      modelId: ANY_MODEL,
      error: { kind: 'io' },
    });
    expect(errorOf(state, model.id)).toEqual({ kind: 'io' });
    expect(errorOf(state, STRONGER)).toEqual({ kind: 'io' });
  });

  it('forgets the general error once the models could be loaded', () => {
    const failed = setupReducer(INITIAL_SETUP, {
      type: 'error',
      modelId: ANY_MODEL,
      error: { kind: 'io' },
    });
    const state = setupReducer(failed, { type: 'loaded', statuses: [missing], hardware: null });
    expect(errorOf(state, model.id)).toBeNull();
  });

  it('reports a running job for any model', () => {
    expect(hasRunningJob(INITIAL_SETUP)).toBe(false);
    expect(hasRunningJob(loaded())).toBe(false);
    for (const running of ['downloading', 'verifying', 'importing', 'deleting'] as const) {
      const state = setupReducer(loaded(), {
        type: 'loaded',
        statuses: [{ ...missing, modelId: STRONGER, state: running }],
        hardware: null,
      });
      expect(hasRunningJob(state)).toBe(true);
    }
    const settled = setupReducer(loaded(), {
      type: 'loaded',
      statuses: [{ ...missing, modelId: STRONGER, state: 'ready' }],
      hardware: null,
    });
    expect(hasRunningJob(settled)).toBe(false);
  });

  it('falls back to a ready model when the saved choice was removed meanwhile', () => {
    const statuses = [
      { ...missing, state: 'ready' as const },
      { ...missing, modelId: STRONGER },
    ];
    const state = setupReducer(INITIAL_SETUP, {
      type: 'loaded',
      statuses,
      hardware: { totalRamBytes: 32 * GIB, freeDiskBytes: null },
      selectedId: STRONGER,
    });
    expect(state.selectedId).toBe(model.id);

    const partial = setupReducer(INITIAL_SETUP, {
      type: 'loaded',
      statuses: [
        { ...missing, state: 'ready' },
        { ...missing, modelId: STRONGER, downloadedBytes: 5 },
      ],
      hardware: null,
      selectedId: STRONGER,
    });
    expect(partial.selectedId).toBe(STRONGER);

    const nothingReady = setupReducer(INITIAL_SETUP, {
      type: 'loaded',
      statuses: [missing, { ...missing, modelId: STRONGER }],
      hardware: null,
      selectedId: STRONGER,
    });
    expect(nothingReady.selectedId).toBe(STRONGER);

    const later = setupReducer(state, { type: 'selected', modelId: STRONGER });
    const refreshed = setupReducer(later, { type: 'loaded', statuses: [], hardware: null });
    expect(refreshed.selectedId).toBe(STRONGER);
  });

  it('follows the check progress only while the model is being checked', () => {
    const unverified = loaded({ ...missing, state: 'unverified', downloadedBytes: 1000 });
    const checking = setupReducer(unverified, {
      type: 'mark',
      modelId: model.id,
      state: 'verifying',
    });
    expect(checking.statuses[model.id]).toMatchObject({ state: 'verifying', downloadedBytes: 0 });
    const checked = {
      type: 'event',
      at: 0,
      event: { modelId: model.id, state: 'verifying', downloadedBytes: 400, totalBytes: 1000 },
    } as const;
    expect(setupReducer(checking, checked).statuses[model.id]).toMatchObject({
      state: 'verifying',
      downloadedBytes: 400,
    });
    const done = setupReducer(checking, {
      type: 'status',
      status: { ...missing, state: 'ready', downloadedBytes: 1000 },
    });
    expect(setupReducer(done, checked)).toBe(done);
  });

  it('marks the state of a known model and ignores unknown ones', () => {
    const state = loaded();
    const marked = setupReducer(state, { type: 'mark', modelId: model.id, state: 'verifying' });
    expect(marked.statuses[model.id]).toMatchObject({ state: 'verifying', totalBytes: 1000 });
    expect(setupReducer(state, { type: 'mark', modelId: 'other', state: 'ready' })).toBe(state);
  });
});
