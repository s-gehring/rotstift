// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarCorrector } from '../llm/sidecar-corrector.ts';
import type { ModelClient } from '../models/client.ts';
import type { CreateCorrector } from '../models/corrector-setup.ts';
import { defaultCorrector } from '../models/registry.ts';
import type { ModelState } from '../models/types.ts';
import { CORRECTOR_MISSING_MESSAGE } from './provider.ts';
import { useCorrector, type CorrectorChoice } from './use-corrector.ts';
import { tick, waitFor } from '../review/test-support.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const model = defaultCorrector();

function fakeClient(state: ModelState): ModelClient {
  return {
    status: (modelId) => Promise.resolve({ modelId, state, downloadedBytes: 0, totalBytes: 1 }),
    hardware: () => Promise.resolve({ totalRamBytes: 8 * 1024 ** 3, freeDiskBytes: 50e9 }),
    verify: (modelId) =>
      Promise.resolve({ modelId, state: 'ready', downloadedBytes: 1, totalBytes: 1 }),
    startDownload: () => Promise.resolve(undefined),
    cancelDownload: () => Promise.resolve(false),
    selection: () => Promise.resolve(null),
    select: () => Promise.resolve(undefined),
    remove: (modelId) =>
      Promise.resolve({ modelId, state: 'missing', downloadedBytes: 0, totalBytes: 1 }),
    importFiles: () => Promise.resolve(null),
    onDownload: () => Promise.resolve(() => undefined),
  };
}

const sidecar: SidecarCorrector = {
  engine: { getPhase: () => 'starting', subscribe: () => () => undefined },
  correct: () => Promise.resolve({ ok: true, correctedText: '' }),
};

let container: HTMLElement;
let root: Root;
let latest: CorrectorChoice | null = null;

function Probe({
  client,
  create,
}: {
  readonly client: ModelClient | null;
  readonly create: CreateCorrector;
}) {
  const choice = useCorrector(client, create);
  useEffect(() => {
    latest = choice;
  });
  return null;
}

async function render(client: ModelClient | null) {
  const create = vi.fn<CreateCorrector>(() => sidecar);
  act(() => root.render(<Probe client={client} create={create} />));
  await act(async () => {
    await tick();
    await tick();
  });
  return create;
}

beforeAll(async () => {
  await import('./preview-corrector.ts');
});

beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
  latest = null;
});

afterEach(() => {
  act(() => root.unmount());
});

describe('useCorrector', () => {
  it('asks for the correction model in the desktop app while it is missing', async () => {
    const create = await render(fakeClient('missing'));
    expect(latest?.status).toEqual({ state: 'needs-model', message: CORRECTOR_MISSING_MESSAGE });
    expect(create).not.toHaveBeenCalled();
  });

  it('uses the sidecar corrector with its engine once the model is ready', async () => {
    const create = await render(fakeClient('ready'));
    expect(create).toHaveBeenCalledWith(model, expect.anything());
    expect(latest?.status).toEqual({
      state: 'ready',
      corrector: sidecar,
      preview: false,
      engine: sidecar.engine,
    });
  });

  it('falls back to the preview corrector in the browser', async () => {
    const create = await render(null);
    await act(() => waitFor(() => latest?.status !== null));
    expect(latest?.status).toMatchObject({ state: 'ready', preview: true });
    expect(latest?.setup.setup.available).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
