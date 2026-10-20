import { describe, expect, it, vi } from 'vitest';
import type { EngineMonitor } from '../pipeline/transcriber.ts';
import type { Corrector } from './corrector.ts';
import { createFakeCorrector } from './fake-corrector.ts';
import {
  CORRECTOR_DESKTOP_ONLY,
  CORRECTOR_MISSING_MESSAGE,
  resolveBrowserCorrector,
  sidecarCorrectorStatus,
  type CorrectorEnvironment,
} from './provider.ts';

function env(overrides: Partial<CorrectorEnvironment>): CorrectorEnvironment {
  return {
    isDev: false,
    loadPreview: vi.fn<() => Promise<Corrector>>(() => Promise.resolve(createFakeCorrector('x'))),
    ...overrides,
  };
}

describe('resolveBrowserCorrector', () => {
  it('uses the preview corrector during development', async () => {
    const status = await resolveBrowserCorrector(env({ isDev: true }));
    expect(status).toMatchObject({ state: 'ready', preview: true });
  });

  it('is unavailable in a production browser build', async () => {
    const environment = env({});
    await expect(resolveBrowserCorrector(environment)).resolves.toEqual({
      state: 'unavailable',
      message: CORRECTOR_DESKTOP_ONLY,
    });
    expect(environment.loadPreview).not.toHaveBeenCalled();
  });
});

describe('sidecarCorrectorStatus', () => {
  const engine: EngineMonitor = { getPhase: () => 'idle', subscribe: () => () => undefined };
  const corrector = { ...createFakeCorrector('x'), engine };

  it('waits until the model state is known', () => {
    expect(sidecarCorrectorStatus(null)).toBeNull();
  });

  it('asks for the correction model while it is missing', () => {
    expect(sidecarCorrectorStatus({ state: 'missing', corrector: null })).toEqual({
      state: 'needs-model',
      message: CORRECTOR_MISSING_MESSAGE,
    });
  });

  it.each([
    ['downloading', 'heruntergeladen'],
    ['unverified', 'geprüft'],
    ['corrupt', 'beschädigt'],
  ] as const)('describes the model state %s', (state, text) => {
    const status = sidecarCorrectorStatus({ state, corrector: null });
    expect(status?.state).toBe('needs-model');
    expect(status?.state === 'needs-model' && status.message).toContain(text);
  });

  it('offers the sidecar corrector with its engine once the model is ready', () => {
    expect(sidecarCorrectorStatus({ state: 'ready', corrector })).toEqual({
      state: 'ready',
      corrector,
      preview: false,
      engine,
    });
    expect(sidecarCorrectorStatus({ state: 'ready', corrector: null })?.state).toBe('needs-model');
  });
});
