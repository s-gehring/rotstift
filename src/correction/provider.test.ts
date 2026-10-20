import { describe, expect, it, vi } from 'vitest';
import type { Corrector } from './corrector.ts';
import { createFakeCorrector } from './fake-corrector.ts';
import {
  CORRECTOR_DESKTOP_ONLY,
  CORRECTOR_MISSING_MESSAGE,
  resolveCorrector,
  type CorrectorEnvironment,
} from './provider.ts';

function env(overrides: Partial<CorrectorEnvironment>): CorrectorEnvironment {
  return {
    isDev: false,
    isTauri: false,
    loadPreview: vi.fn<() => Promise<Corrector>>(() => Promise.resolve(createFakeCorrector('x'))),
    ...overrides,
  };
}

describe('resolveCorrector', () => {
  it('reports the missing correction model in the desktop app', async () => {
    const environment = env({ isTauri: true, isDev: true });
    await expect(resolveCorrector(environment)).resolves.toEqual({
      state: 'needs-model',
      message: CORRECTOR_MISSING_MESSAGE,
    });
    expect(environment.loadPreview).not.toHaveBeenCalled();
  });

  it('uses the preview corrector in the browser during development', async () => {
    const status = await resolveCorrector(env({ isDev: true }));
    expect(status).toMatchObject({ state: 'ready', preview: true });
  });

  it('is unavailable in a production browser build', async () => {
    await expect(resolveCorrector(env({}))).resolves.toEqual({
      state: 'unavailable',
      message: CORRECTOR_DESKTOP_ONLY,
    });
  });
});
