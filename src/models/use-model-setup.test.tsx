// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelCallError, type ModelClient } from './client.ts';
import { DEFAULT_MODEL_ID, recommendModel } from './registry.ts';
import type { ModelSetup } from './use-model-setup.ts';
import { useModelSetup } from './use-model-setup.ts';
import type { ModelState, ModelStatus } from './types.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const model = recommendModel();

const statusOf = (state: ModelState): ModelStatus => ({
  modelId: model.id,
  state,
  downloadedBytes: 100,
  totalBytes: 100,
});

function fakeClient(
  initial: ModelState,
  verified: Promise<ModelStatus>,
  overrides: Partial<ModelClient> = {},
) {
  const states = { current: initial };
  const verify = vi.fn<ModelClient['verify']>(() => verified);
  const status = vi.fn<ModelClient['status']>(() => Promise.resolve(statusOf(states.current)));
  const client: ModelClient = {
    status: (modelId) =>
      modelId === model.id ? status(modelId) : Promise.resolve({ ...statusOf('missing'), modelId }),
    hardware: () => Promise.reject(new Error('no hardware')),
    verify,
    startDownload: () => Promise.resolve(undefined),
    cancelDownload: () => Promise.resolve(false),
    selection: () => Promise.resolve(null),
    select: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(statusOf('missing')),
    importFiles: () => Promise.resolve(null),
    onDownload: () => Promise.resolve(() => undefined),
    ...overrides,
  };
  return { client, verify, status, states };
}

let container: HTMLElement;
let root: Root;
let latest: ModelSetup | null = null;

function Probe({ client }: { readonly client: ModelClient }) {
  const setup = useModelSetup(client);
  useEffect(() => {
    latest = setup;
  });
  return <p>{setup.status?.state}</p>;
}

const mount = async (client: ModelClient) => {
  await act(async () => {
    root.render(<Probe client={client} />);
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

describe('useModelSetup verification', () => {
  it('shows unverified files as being checked and applies the verified result', async () => {
    const handle: { finish: (value: ModelStatus) => void } = { finish: () => undefined };
    const verified = new Promise<ModelStatus>((resolve) => {
      handle.finish = resolve;
    });
    const { client, verify } = fakeClient('unverified', verified);
    await mount(client);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledExactlyOnceWith(model.id));
    expect(container.textContent).toBe('verifying');

    await act(async () => {
      handle.finish(statusOf('ready'));
      await verified;
    });
    expect(container.textContent).toBe('ready');
  });

  it('does not verify twice and ignores a busy answer', async () => {
    const busy = Promise.reject(new ModelCallError({ kind: 'busy' }));
    busy.catch(() => undefined);
    const { client, verify } = fakeClient('unverified', busy);
    await mount(client);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce());
    await act(async () => {
      await latest?.refresh();
    });
    expect(latest?.state.error).toBeNull();
  });

  it('does not verify files that are already known to be fine', async () => {
    const { client, verify } = fakeClient('ready', Promise.resolve(statusOf('ready')));
    await mount(client);
    await vi.waitFor(() => expect(container.textContent).toBe('ready'));
    expect(verify).not.toHaveBeenCalled();
  });

  it('refreshes the model status on request', async () => {
    const { client, states } = fakeClient('ready', Promise.resolve(statusOf('ready')));
    await mount(client);
    await vi.waitFor(() => expect(container.textContent).toBe('ready'));
    states.current = 'missing';
    await act(async () => {
      await latest?.refresh();
    });
    expect(container.textContent).toBe('missing');
  });

  it('reloads the real status when the check fails and lets the user retry', async () => {
    const failing = Promise.reject(new ModelCallError({ kind: 'io', detail: 'locked' }));
    failing.catch(() => undefined);
    const { client, verify, status } = fakeClient('unverified', failing);
    await mount(client);
    await vi.waitFor(() => expect(container.textContent).toBe('unverified'));
    expect(latest?.state.error).toEqual({ kind: 'io', detail: 'locked' });
    expect(status).toHaveBeenCalledTimes(2);

    verify.mockResolvedValueOnce(statusOf('ready'));
    await act(async () => {
      await latest?.verifyAgain();
    });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('ready');
    expect(latest?.state.error).toBeNull();
  });

  it('falls back to unverified when even the status cannot be reloaded', async () => {
    const failing = Promise.reject(new ModelCallError({ kind: 'io' }));
    failing.catch(() => undefined);
    const { client, status } = fakeClient('unverified', failing);
    status.mockResolvedValueOnce(statusOf('unverified'));
    status.mockRejectedValue(new Error('gone'));
    await mount(client);
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(container.textContent).toBe('unverified'));
  });
});

describe('useModelSetup model choice', () => {
  const STRONGER = 'qwen3-vl-4b-q4';
  const big = { totalRamBytes: 32 * 1024 ** 3, freeDiskBytes: null };

  it('uses the default model when nothing was chosen before', async () => {
    const { client } = fakeClient('ready', Promise.resolve(statusOf('ready')), {
      hardware: () => Promise.resolve(big),
    });
    await mount(client);
    await vi.waitFor(() => expect(latest?.state.loaded).toBe(true));
    expect(latest?.model.id).toBe(DEFAULT_MODEL_ID);
  });

  it('restores the persisted choice after a restart', async () => {
    const { client } = fakeClient('ready', Promise.resolve(statusOf('ready')), {
      hardware: () => Promise.resolve(big),
      selection: () => Promise.resolve(STRONGER),
    });
    await mount(client);
    await vi.waitFor(() => expect(latest?.model.id).toBe(STRONGER));
  });

  it('ignores a persisted choice the machine no longer qualifies for', async () => {
    const { client } = fakeClient('ready', Promise.resolve(statusOf('ready')), {
      hardware: () => Promise.resolve({ totalRamBytes: 8 * 1024 ** 3, freeDiskBytes: null }),
      selection: () => Promise.resolve(STRONGER),
    });
    await mount(client);
    await vi.waitFor(() => expect(latest?.state.loaded).toBe(true));
    expect(latest?.model.id).toBe(DEFAULT_MODEL_ID);
  });

  it('persists a switch through the backend and then uses the new model', async () => {
    const select = vi.fn<ModelClient['select']>(() => Promise.resolve(undefined));
    const { client } = fakeClient('ready', Promise.resolve(statusOf('ready')), {
      hardware: () => Promise.resolve(big),
      select,
    });
    await mount(client);
    await vi.waitFor(() => expect(latest?.state.loaded).toBe(true));
    await act(async () => {
      await latest?.select(STRONGER);
    });
    expect(select).toHaveBeenCalledExactlyOnceWith(STRONGER);
    expect(latest?.model.id).toBe(STRONGER);

    await act(async () => {
      await latest?.select(STRONGER);
    });
    expect(select).toHaveBeenCalledOnce();

    await act(async () => {
      await latest?.select(DEFAULT_MODEL_ID);
    });
    expect(select).toHaveBeenLastCalledWith(DEFAULT_MODEL_ID);
    expect(latest?.model.id).toBe(DEFAULT_MODEL_ID);
  });

  it('keeps the current model and reports the error when the switch fails', async () => {
    const { client } = fakeClient('ready', Promise.resolve(statusOf('ready')), {
      hardware: () => Promise.resolve(big),
      select: () => Promise.reject(new ModelCallError({ kind: 'io', detail: 'read-only' })),
    });
    await mount(client);
    await vi.waitFor(() => expect(latest?.state.loaded).toBe(true));
    await act(async () => {
      await latest?.select(STRONGER);
    });
    expect(latest?.model.id).toBe(DEFAULT_MODEL_ID);
    expect(latest?.state.error).toEqual({ kind: 'io', detail: 'read-only' });
  });

  it('does nothing without a backend', async () => {
    await act(async () => {
      root.render(<NoBackend />);
      await Promise.resolve();
    });
    await act(async () => {
      await latest?.select(STRONGER);
    });
    expect(latest?.model.id).toBe(DEFAULT_MODEL_ID);
  });
});

function NoBackend() {
  const setup = useModelSetup(null);
  useEffect(() => {
    latest = setup;
  });
  return null;
}
