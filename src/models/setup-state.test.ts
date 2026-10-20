import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID, recommendModel } from './registry.ts';
import { activeModel, INITIAL_SETUP, setupReducer, type SetupState } from './setup-state.ts';
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

function loaded(status: ModelStatus = missing): SetupState {
  return setupReducer(INITIAL_SETUP, { type: 'loaded', statuses: [status], hardware: null });
}

describe('setupReducer', () => {
  it('tracks progress, speed samples and completion', () => {
    let state = loaded();
    state = setupReducer(state, {
      type: 'event',
      at: 100,
      event: { modelId: model.id, state: 'progress', downloadedBytes: 400, totalBytes: 1000 },
    });
    expect(state.statuses[model.id]).toMatchObject({ state: 'downloading', downloadedBytes: 400 });
    expect(state.samples).toEqual([{ at: 100, bytes: 400 }]);

    state = setupReducer(state, {
      type: 'event',
      at: 200,
      event: { modelId: model.id, state: 'done' },
    });
    expect(state.statuses[model.id]).toMatchObject({ state: 'ready', downloadedBytes: 1000 });
    expect(state.samples).toEqual([]);
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
    expect(failed.error).toEqual({ kind: 'incomplete' });
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

  it('drops the speed samples of the previous model when switching', () => {
    const downloading = setupReducer(loaded(), {
      type: 'event',
      at: 1,
      event: { modelId: model.id, state: 'progress', downloadedBytes: 10, totalBytes: 100 },
    });
    expect(downloading.samples).toHaveLength(1);
    expect(setupReducer(downloading, { type: 'selected', modelId: STRONGER }).samples).toEqual([]);
  });

  it('marks the state of a known model and ignores unknown ones', () => {
    const state = loaded();
    const marked = setupReducer(state, { type: 'mark', modelId: model.id, state: 'verifying' });
    expect(marked.statuses[model.id]).toMatchObject({ state: 'verifying', totalBytes: 1000 });
    expect(setupReducer(state, { type: 'mark', modelId: 'other', state: 'ready' })).toBe(state);
  });
});
