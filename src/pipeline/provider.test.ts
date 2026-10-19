import { describe, expect, it, vi } from 'vitest';
import { DESKTOP_ONLY_MESSAGE, NOT_CONFIGURED_MESSAGE, resolveTranscriber } from './provider.ts';
import type { PageTranscriber } from './transcriber.ts';

const demo: PageTranscriber = { transcribe: () => Promise.reject(new Error('unused')) };

function env(isDev: boolean, isTauri: boolean) {
  return {
    isDev,
    isTauri,
    loadDemo: vi.fn<() => Promise<PageTranscriber>>(() => Promise.resolve(demo)),
  };
}

describe('resolveTranscriber', () => {
  it('offers the demo transcriber only in dev outside Tauri', async () => {
    const web = env(true, false);
    expect(await resolveTranscriber(web)).toEqual({
      state: 'ready',
      transcriber: demo,
      demo: true,
    });
    expect(web.loadDemo).toHaveBeenCalledOnce();
  });

  it('reports a missing runtime in the desktop app, even in dev', async () => {
    for (const isDev of [true, false]) {
      const desktop = env(isDev, true);
      expect(await resolveTranscriber(desktop)).toEqual({
        state: 'unavailable',
        message: NOT_CONFIGURED_MESSAGE,
      });
      expect(desktop.loadDemo).not.toHaveBeenCalled();
    }
  });

  it('never loads the demo transcriber in a production web build', async () => {
    const production = env(false, false);
    expect(await resolveTranscriber(production)).toEqual({
      state: 'unavailable',
      message: DESKTOP_ONLY_MESSAGE,
    });
    expect(production.loadDemo).not.toHaveBeenCalled();
  });
});
