import { describe, expect, it } from 'vitest';
import { recommendModel } from './registry.ts';
import { activeModel, INITIAL_SETUP, setupReducer, type SetupState } from './setup-state.ts';
import type { ModelStatus } from './types.ts';

const model = recommendModel(null);
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

  it('prefers a ready model and otherwise the recommended one', () => {
    expect(activeModel(INITIAL_SETUP).id).toBe(model.id);
    expect(activeModel(loaded({ ...missing, state: 'ready' })).id).toBe(model.id);
  });
});
