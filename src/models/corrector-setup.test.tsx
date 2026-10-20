// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarCorrector, SidecarCorrectorOptions } from '../llm/sidecar-corrector.ts';
import type { ModelClient } from './client.ts';
import {
  CorrectorManagement,
  CorrectorSetupDialog,
  useCorrectorSetup,
  type CorrectorSetup,
  type CreateCorrector,
} from './corrector-setup.tsx';
import { defaultCorrector, recommendModel, type CorrectorInfo } from './registry.ts';
import { useModelSetup } from './use-model-setup.ts';
import type { ModelState, ModelStatus } from './types.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const corrector = defaultCorrector();
const transcriber = recommendModel();

function fakeClient(states: Readonly<Record<string, ModelState>>) {
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
  const client: ModelClient = {
    status,
    hardware: () => Promise.resolve({ totalRamBytes: 8 * 1024 ** 3, freeDiskBytes: 50e9 }),
    verify,
    startDownload: () => Promise.resolve(undefined),
    cancelDownload: () => Promise.resolve(false),
    selection,
    select: () => Promise.resolve(undefined),
    remove: (modelId) =>
      Promise.resolve({ modelId, state: 'missing', downloadedBytes: 0, totalBytes: 1 }),
    importFiles: () => Promise.resolve(null),
    onDownload: () => Promise.resolve(() => undefined),
  };
  return { client, status, verify, selection };
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
  return (
    <>
      <CorrectorManagement corrector={setup} />
      <CorrectorSetupDialog corrector={setup} />
    </>
  );
}

const mount = async (client: ModelClient | null, create: CreateCorrector) => {
  await act(async () => {
    root.render(<Probe client={client} create={create} />);
    await Promise.resolve();
  });
};

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent.startsWith(label),
  );

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
  it('reports a missing corrector and opens its own setup dialog', async () => {
    const { client, selection } = fakeClient({ [transcriber.id]: 'ready' });
    const { create } = fakeCreate();
    await mount(client, create);
    await vi.waitFor(() => expect(latest?.setup.status?.state).toBe('missing'));
    expect(latest?.model.id).toBe(corrector.id);
    expect(latest?.ready).toBe(false);
    expect(latest?.corrector).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(selection).not.toHaveBeenCalled();

    const dialog = container.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(false);
    act(() => button('Korrektur einrichten')?.click());
    expect(latest?.dialogOpen).toBe(true);
    expect(dialog?.hasAttribute('open')).toBe(true);
    act(() => button('Schließen')?.click());
    expect(latest?.dialogOpen).toBe(false);
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
    expect(container.querySelector('dialog')).toBeNull();
    expect(container.querySelector('section')).toBeNull();
  });
});

describe('corrector setup dialog', () => {
  it('states model, size, license and the privacy promise for a single file', async () => {
    const { client } = fakeClient({});
    await mount(client, fakeCreate().create);
    await vi.waitFor(() => expect(latest?.setup.status?.state).toBe('missing'));
    const dialog = container.querySelector('dialog');
    const text = dialog?.textContent ?? '';
    expect(dialog?.querySelector('h2')?.textContent).toBe('Korrektur einrichten');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(dialog?.querySelector('h2')?.id);
    expect(text).toContain('Gemma 4 E2B it (Q4_0)');
    expect(text).toContain('2,8 GB');
    expect(text).toContain('huggingface.co (ggml-org/gemma-4-E2B-it-GGUF), Lizenz Apache-2.0');
    expect(text).toContain('Es wird erst zum Berichtigen gebraucht');
    expect(text).toContain('Einmaliger Download, danach komplett offline.');
    expect(text).toContain('Es werden keine Schülerdaten übertragen.');
    expect(text).toContain('die Datei herunterladen');
    expect(text).toContain(corrector.files.model.url);
    expect(text).not.toContain('mmproj');
    expect(dialog?.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(button('Herunterladen (2,8 GB)')).toBeDefined();
  });

  it('confirms when the corrector is ready', async () => {
    const { client } = fakeClient({ [corrector.id]: 'ready' });
    await mount(client, fakeCreate().create);
    await vi.waitFor(() => expect(latest?.ready).toBe(true));
    expect(container.querySelector('dialog [role="status"]')?.textContent).toBe(
      'Die Korrektur ist eingerichtet. Berichtigen funktioniert jetzt ohne Internet.',
    );
  });
});

describe('corrector management', () => {
  it('lists the corrector separately and deletes it only after a confirmation', async () => {
    const { client } = fakeClient({ [corrector.id]: 'ready' });
    await mount(client, fakeCreate().create);
    await vi.waitFor(() => expect(latest?.ready).toBe(true));
    const section = container.querySelector('section');
    expect(section?.getAttribute('aria-label')).toBe('Korrektur verwalten');
    expect(section?.textContent).toContain('Gemma 4 E2B it (Q4_0): Eingerichtet');
    expect(section?.textContent).toContain('2,8 GB');
    expect(section?.textContent).not.toContain('Diagnose');
    act(() => button('Modell löschen')?.click());
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain(
      'Zum Berichtigen muss es danach erneut heruntergeladen werden.',
    );
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
