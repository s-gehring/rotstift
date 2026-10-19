// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelCallError, type ModelClient } from './client.ts';
import { recommendModel } from './registry.ts';
import type { ModelSetup } from './use-model-setup.ts';
import { useModelSetup } from './use-model-setup.ts';
import type { ModelState, ModelStatus } from './types.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const model = recommendModel(null);

const status = (state: ModelState): ModelStatus => ({
  modelId: model.id,
  state,
  downloadedBytes: 100,
  totalBytes: 100,
});

function fakeClient(initial: ModelState, verified: Promise<ModelStatus>) {
  const states = { current: initial };
  const verify = vi.fn<ModelClient['verify']>(() => verified);
  const client: ModelClient = {
    status: () => Promise.resolve(status(states.current)),
    hardware: () => Promise.reject(new Error('no hardware')),
    verify,
    startDownload: () => Promise.resolve(undefined),
    cancelDownload: () => Promise.resolve(false),
    remove: () => Promise.resolve(status('missing')),
    importFiles: () => Promise.resolve(null),
    onDownload: () => Promise.resolve(() => undefined),
  };
  return { client, verify, states };
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
      handle.finish(status('ready'));
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
    const { client, verify } = fakeClient('ready', Promise.resolve(status('ready')));
    await mount(client);
    await vi.waitFor(() => expect(container.textContent).toBe('ready'));
    expect(verify).not.toHaveBeenCalled();
  });

  it('refreshes the model status on request', async () => {
    const { client, states } = fakeClient('ready', Promise.resolve(status('ready')));
    await mount(client);
    await vi.waitFor(() => expect(container.textContent).toBe('ready'));
    states.current = 'missing';
    await act(async () => {
      await latest?.refresh();
    });
    expect(container.textContent).toBe('missing');
  });
});
