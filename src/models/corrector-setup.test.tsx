// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarCorrector, SidecarCorrectorOptions } from '../llm/sidecar-corrector.ts';
import type { ModelClient } from './client.ts';
import {
  useCorrectorSetup,
  useReviewerSetup,
  type CorrectorSetup,
  type CreateCorrector,
} from './corrector-setup.ts';
import {
  CORRECTORS,
  defaultCorrector,
  defaultReviewer,
  recommendModel,
  type CorrectorInfo,
} from './registry.ts';
import { useModelSetup } from './use-model-setup.ts';
import type { ModelState, ModelStatus } from './types.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const corrector = defaultCorrector();
const reviewer = defaultReviewer();
const transcriber = recommendModel();

function fakeClient(initial: Readonly<Record<string, ModelState>>) {
  const states: Record<string, ModelState> = { ...initial };
  const status = vi.fn<ModelClient['status']>((modelId): Promise<ModelStatus> =>
    Promise.resolve({
      modelId,
      state: states[modelId] ?? 'missing',
      downloadedBytes: 0,
      totalBytes: 1,
    }),
  );
  const verify = vi.fn<ModelClient['verify']>((modelId) =>
    Promise.resolve({ modelId, state: 'ready', downloadedBytes: 1, totalBytes: 1 }),
  );
  const selection = vi.fn<ModelClient['selection']>(() => Promise.resolve(null));
  const reviewerSelection = vi.fn<ModelClient['reviewerSelection']>(() => Promise.resolve(null));
  const selectReviewer = vi.fn<ModelClient['selectReviewer']>(() => Promise.resolve(undefined));
  const client: ModelClient = {
    status,
    hardware: () => Promise.resolve({ totalRamBytes: 8 * 1024 ** 3, freeDiskBytes: 50e9 }),
    verify,
    startDownload: () => Promise.resolve(undefined),
    cancelDownload: () => Promise.resolve(false),
    selection,
    select: () => Promise.resolve(undefined),
    reviewerSelection,
    selectReviewer,
    correctorSelection: () => Promise.resolve(null),
    selectCorrector: () => Promise.resolve(undefined),
    customModels: () => Promise.resolve([]),
    resolveLink: () => Promise.reject(new Error('offline')),
    addLink: () => Promise.reject(new Error('offline')),
    importCustom: () => Promise.resolve(null),
    probe: () => Promise.resolve(null),
    remove: (modelId) => {
      states[modelId] = 'missing';
      return Promise.resolve({ modelId, state: 'missing', downloadedBytes: 0, totalBytes: 1 });
    },
    importFiles: () => Promise.resolve(null),
    onDownload: () => Promise.resolve(() => undefined),
  };
  return { client, status, verify, selection, reviewerSelection, selectReviewer };
}

function fakeCreate() {
  const created: { model: CorrectorInfo; options: SidecarCorrectorOptions | undefined }[] = [];
  const create = vi.fn<CreateCorrector>((model, options) => {
    created.push({ model, options });
    const instance: SidecarCorrector = {
      engine: { getPhase: () => 'idle', subscribe: () => () => undefined },
      correct: () => Promise.resolve({ ok: true, correctedText: '' }),
    };
    return instance;
  });
  return { create, created };
}

let container: HTMLElement;
let root: Root;
let latest: CorrectorSetup | null = null;

function Probe({
  client,
  create,
}: {
  readonly client: ModelClient | null;
  readonly create: CreateCorrector;
}) {
  const setup = useCorrectorSetup(client, create);
  useEffect(() => {
    latest = setup;
  });
  return <p>{setup.setup.status?.state}</p>;
}

const mount = async (client: ModelClient | null, create: CreateCorrector) => {
  await act(async () => {
    root.render(<Probe client={client} create={create} />);
    await Promise.resolve();
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  latest = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useCorrectorSetup', () => {
  it('reports a missing corrector without building a sidecar', async () => {
    const { client, selection, status } = fakeClient({ [transcriber.id]: 'ready' });
    const { create } = fakeCreate();
    await mount(client, create);
    await vi.waitFor(() => expect(latest?.setup.status?.state).toBe('missing'));
    expect(latest?.model.id).toBe(corrector.id);
    expect(latest?.ready).toBe(false);
    expect(latest?.corrector).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
    expect(new Set(status.mock.calls.map(([modelId]) => modelId))).toEqual(
      new Set(CORRECTORS.map((entry) => entry.id)),
    );
  });

  it('builds the sidecar corrector once the model is ready and refreshes when it vanishes', async () => {
    const { client, status } = fakeClient({ [corrector.id]: 'ready' });
    const { create, created } = fakeCreate();
    await mount(client, create);
    await vi.waitFor(() => expect(latest?.ready).toBe(true));
    expect(latest?.corrector).not.toBeNull();
    expect(created.map((entry) => entry.model.id)).toEqual([corrector.id]);

    const calls = status.mock.calls.length;
    await act(async () => {
      created[0]?.options?.onUnavailable?.();
      await Promise.resolve();
    });
    expect(status.mock.calls.length).toBeGreaterThan(calls);
  });

  it('verifies only the files of its own role', async () => {
    const { client, verify } = fakeClient({
      [corrector.id]: 'unverified',
      [transcriber.id]: 'unverified',
    });
    const { create } = fakeCreate();
    await mount(client, create);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledExactlyOnceWith(corrector.id));
  });

  it('is unavailable outside the desktop app', async () => {
    const { create } = fakeCreate();
    await mount(null, create);
    expect(latest?.ready).toBe(false);
    expect(latest?.corrector).toBeNull();
    expect(latest?.setup.available).toBe(false);
  });
});

describe('transcriber setup', () => {
  it('chooses only between transcribers and leaves the corrector to its own setup', async () => {
    const { client, verify } = fakeClient({ [corrector.id]: 'unverified' });
    const seen: string[] = [];
    function Transcriber() {
      const setup = useModelSetup(client);
      useEffect(() => {
        seen.push(...setup.models.map((model) => model.id));
      });
      return <p>{setup.model.id}</p>;
    }
    await act(async () => {
      root.render(<Transcriber />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe(transcriber.id);
    expect(seen).not.toContain(corrector.id);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('useReviewerSetup', () => {
  it('builds a sidecar for the reviewer model once it is ready', async () => {
    const { client, reviewerSelection, selection } = fakeClient({ [reviewer.id]: 'ready' });
    const { create, created } = fakeCreate();
    await act(async () => {
      root.render(<ReviewerProbe client={client} create={create} />);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(latest?.ready).toBe(true));
    expect(created.map((entry) => entry.model.id)).toEqual([reviewer.id]);
    expect(reviewerSelection).toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();
  });

  it('reports a missing reviewer model without building a sidecar', async () => {
    const { client } = fakeClient({});
    const { create } = fakeCreate();
    await act(async () => {
      root.render(<ReviewerProbe client={client} create={create} />);
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(latest?.setup.status?.state).toBe('missing'));
    expect(latest?.corrector).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('refreshes the other role when the shared file is deleted from one of them', async () => {
    const { client } = fakeClient({ [corrector.id]: 'ready' });
    const { create } = fakeCreate();
    let both: { corrector: CorrectorSetup; reviewer: CorrectorSetup } | null = null;
    function Both() {
      const first = useCorrectorSetup(client, create);
      const second = useReviewerSetup(client, create);
      useEffect(() => {
        both = { corrector: first, reviewer: second };
      });
      return null;
    }
    await act(async () => {
      root.render(<Both />);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(both?.corrector.ready).toBe(true);
      expect(both?.reviewer.ready).toBe(true);
    });

    await act(async () => {
      await both?.corrector.setup.remove();
    });
    await vi.waitFor(() => {
      expect(both?.corrector.ready).toBe(false);
      expect(both?.reviewer.ready).toBe(false);
    });
  });
});

function ReviewerProbe({
  client,
  create,
}: {
  readonly client: ModelClient | null;
  readonly create: CreateCorrector;
}) {
  const setup = useReviewerSetup(client, create);
  useEffect(() => {
    latest = setup;
  });
  return null;
}
