import { describe, expect, it, vi } from 'vitest';
import { MODELS, secondReader } from '../models/registry.ts';
import {
  DESKTOP_ONLY_MESSAGE,
  resolveTranscriber,
  type TranscriberEnvironment,
} from './provider.ts';
import type { PageTranscriber } from './transcriber.ts';

const preview: PageTranscriber = { transcribe: () => Promise.reject(new Error('unused')) };
const model = MODELS[0];
if (model === undefined) throw new Error('registry is empty');

function env(isDev: boolean, isTauri: boolean) {
  const engine = { getPhase: () => 'idle' as const, subscribe: () => () => undefined };
  return {
    isDev,
    isTauri,
    loadPreview: vi.fn<() => Promise<PageTranscriber>>(() => Promise.resolve(preview)),
    createModelTranscriber: vi.fn<TranscriberEnvironment['createModelTranscriber']>(() => ({
      ...preview,
      engine,
    })),
  };
}

describe('resolveTranscriber', () => {
  it('offers the preview transcriber only in dev outside Tauri', async () => {
    const web = env(true, false);
    expect(await resolveTranscriber(web, null)).toEqual({
      state: 'ready',
      transcriber: preview,
      preview: true,
    });
    expect(web.loadPreview).toHaveBeenCalledOnce();
    expect(web.createModelTranscriber).not.toHaveBeenCalled();
  });

  it('never loads the preview transcriber in a production web build', async () => {
    const production = env(false, false);
    expect(await resolveTranscriber(production, null)).toEqual({
      state: 'unavailable',
      message: DESKTOP_ONLY_MESSAGE,
    });
    expect(production.loadPreview).not.toHaveBeenCalled();
  });

  it('waits for the model status in the desktop app, even in dev', async () => {
    for (const isDev of [true, false]) {
      const desktop = env(isDev, true);
      expect(await resolveTranscriber(desktop, null)).toBeNull();
      expect(desktop.loadPreview).not.toHaveBeenCalled();
    }
  });

  it('treats a model that is being checked as a pending problem', async () => {
    for (const state of ['verifying', 'unverified'] as const) {
      const desktop = env(false, true);
      expect(await resolveTranscriber(desktop, { model, state })).toEqual({
        state: 'needs-model',
        problem: 'verifying',
      });
      expect(desktop.createModelTranscriber).not.toHaveBeenCalled();
    }
  });

  it('reports an import or deletion in progress as a pending problem', async () => {
    for (const state of ['importing', 'deleting'] as const) {
      const desktop = env(false, true);
      expect(await resolveTranscriber(desktop, { model, state })).toEqual({
        state: 'needs-model',
        problem: state,
      });
    }
  });

  it('passes the unavailable callback on to the model transcriber', async () => {
    const desktop = env(false, true);
    const onUnavailable = vi.fn<() => void>();
    await resolveTranscriber(desktop, { model, state: 'ready' }, onUnavailable);
    expect(desktop.createModelTranscriber).toHaveBeenCalledWith(model, onUnavailable, false, null);
  });

  it('builds a remote transcriber for a cloud step', async () => {
    const desktop = env(false, true);
    await resolveTranscriber(desktop, { model, state: 'ready', remote: true });
    expect(desktop.createModelTranscriber).toHaveBeenCalledWith(model, undefined, true, null);
  });

  it('hands the model for the second reading on', async () => {
    const desktop = env(false, true);
    const second = secondReader();
    await resolveTranscriber(desktop, { model, state: 'ready', second });
    expect(desktop.createModelTranscriber).toHaveBeenCalledWith(model, undefined, false, second);
  });

  it('asks for the setup while the model is missing, downloading or corrupt', async () => {
    for (const state of ['missing', 'downloading', 'corrupt'] as const) {
      const desktop = env(false, true);
      expect(await resolveTranscriber(desktop, { model, state })).toEqual({
        state: 'needs-model',
        problem: state,
      });
      expect(desktop.createModelTranscriber).not.toHaveBeenCalled();
    }
  });

  it('reports the real transcriber once the model is ready', async () => {
    const desktop = env(false, true);
    const status = await resolveTranscriber(desktop, { model, state: 'ready' });
    expect(status).toMatchObject({ state: 'ready', preview: false });
    expect(desktop.createModelTranscriber).toHaveBeenCalledWith(model, undefined, false, null);
    expect(desktop.loadPreview).not.toHaveBeenCalled();
    expect(status?.state === 'ready' && status.engine?.getPhase()).toBe('idle');
  });
});
