// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudStep } from '../cloud/client.ts';
import type { SidecarCorrector } from '../llm/sidecar-corrector.ts';
import type { ModelClient } from '../models/client.ts';
import type { CreateCorrector } from '../models/corrector-setup.ts';
import { defaultCorrector } from '../models/registry.ts';
import type { ModelState } from '../models/types.ts';
import { CORRECTOR_MISSING_MESSAGE, REVIEWER_MISSING_MESSAGE } from './provider.ts';
import { useCorrector, useReviewer, type CorrectorChoice } from './use-corrector.ts';
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
    reviewerSelection: () => Promise.resolve(null),
    selectReviewer: () => Promise.resolve(undefined),
    correctorSelection: () => Promise.resolve(null),
    selectCorrector: () => Promise.resolve(undefined),
    customModels: () => Promise.resolve([]),
    resolveLink: () => Promise.reject(new Error('offline')),
    addLink: () => Promise.reject(new Error('offline')),
    importCustom: () => Promise.resolve(null),
    probe: () => Promise.resolve(null),
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
  cloud = null,
}: {
  readonly client: ModelClient | null;
  readonly create: CreateCorrector;
  readonly cloud?: CloudStep | null;
}) {
  const choice = useCorrector(client, create, cloud);
  useEffect(() => {
    latest = choice;
  });
  return null;
}

function ReviewerProbe({
  client,
  create,
}: {
  readonly client: ModelClient | null;
  readonly create: CreateCorrector;
}) {
  const choice = useReviewer(client, create);
  useEffect(() => {
    latest = choice;
  });
  return null;
}

async function render(
  client: ModelClient | null,
  Component: typeof Probe = Probe,
  cloud: CloudStep | null = null,
) {
  const create = vi.fn<CreateCorrector>(() => sidecar);
  act(() => root.render(<Component client={client} create={create} cloud={cloud} />));
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

  it('corrects through the cloud step without loading the local model', async () => {
    const step: CloudStep = {
      template: 'mistral',
      label: 'Mistral AI',
      baseUrl: 'https://api.mistral.ai/v1',
      host: 'api.mistral.ai',
      model: 'mistral-small-latest',
      loopback: false,
      confirmed: true,
      key: 'system',
    };
    const create = await render(fakeClient('ready'), Probe, step);
    expect(create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'cloud-corrector' }),
      expect.objectContaining({ engine: expect.anything(), client: expect.anything() }),
    );
    expect(latest?.status).toMatchObject({ state: 'ready', corrector: sidecar });

    const blocked = await render(fakeClient('ready'), Probe, { ...step, key: null });
    expect(blocked).not.toHaveBeenCalled();
    expect(latest?.status).toEqual({
      state: 'unavailable',
      message: 'Für Mistral AI fehlt der Schlüssel. Bitte in den Einstellungen eingeben.',
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

describe('useReviewer', () => {
  it('asks for the model for content and form while it is missing', async () => {
    const create = await render(fakeClient('missing'), ReviewerProbe);
    expect(latest?.status).toEqual({ state: 'needs-model', message: REVIEWER_MISSING_MESSAGE });
    expect(create).not.toHaveBeenCalled();
  });

  it('uses a sidecar for the shared model once it is ready', async () => {
    const create = await render(fakeClient('ready'), ReviewerProbe);
    expect(create).toHaveBeenCalledWith(model, expect.anything());
    expect(latest?.status).toMatchObject({ state: 'ready', corrector: sidecar, preview: false });
  });

  it('falls back to the preview corrector in the browser', async () => {
    await render(null, ReviewerProbe);
    await act(() => waitFor(() => latest?.status !== null));
    expect(latest?.status).toMatchObject({ state: 'ready', preview: true });
  });
});
