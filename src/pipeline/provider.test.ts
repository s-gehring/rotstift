import { describe, expect, it, vi } from 'vitest';
import { MODELS } from '../models/registry.ts';
import {
  DESKTOP_ONLY_MESSAGE,
  resolveTranscriber,
  type TranscriberEnvironment,
} from './provider.ts';
import type { PageTranscriber } from './transcriber.ts';

const demo: PageTranscriber = { transcribe: () => Promise.reject(new Error('unused')) };
const model = MODELS[0];
if (model === undefined) throw new Error('registry is empty');

function env(isDev: boolean, isTauri: boolean) {
  const engine = { getPhase: () => 'idle' as const, subscribe: () => () => undefined };
  return {
    isDev,
    isTauri,
    loadDemo: vi.fn<() => Promise<PageTranscriber>>(() => Promise.resolve(demo)),
    createModelTranscriber: vi.fn<TranscriberEnvironment['createModelTranscriber']>(() => ({
      ...demo,
      engine,
    })),
  };
}

describe('resolveTranscriber', () => {
  it('offers the demo transcriber only in dev outside Tauri', async () => {
    const web = env(true, false);
    expect(await resolveTranscriber(web, null)).toEqual({
      state: 'ready',
      transcriber: demo,
      demo: true,
    });
    expect(web.loadDemo).toHaveBeenCalledOnce();
    expect(web.createModelTranscriber).not.toHaveBeenCalled();
  });

  it('never loads the demo transcriber in a production web build', async () => {
    const production = env(false, false);
    expect(await resolveTranscriber(production, null)).toEqual({
      state: 'unavailable',
      message: DESKTOP_ONLY_MESSAGE,
    });
    expect(production.loadDemo).not.toHaveBeenCalled();
  });

  it('waits for the model status in the desktop app, even in dev', async () => {
    for (const isDev of [true, false]) {
      const desktop = env(isDev, true);
      expect(await resolveTranscriber(desktop, null)).toBeNull();
      expect(desktop.loadDemo).not.toHaveBeenCalled();
    }
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
    expect(status).toMatchObject({ state: 'ready', demo: false });
    expect(desktop.createModelTranscriber).toHaveBeenCalledWith(model);
    expect(desktop.loadDemo).not.toHaveBeenCalled();
    expect(status?.state === 'ready' && status.engine?.getPhase()).toBe('idle');
  });
});
