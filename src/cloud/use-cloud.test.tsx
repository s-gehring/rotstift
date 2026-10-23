// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudCallError, type CloudClient, type CloudInput, type CloudView } from './client.ts';
import { useCloud, type CloudModel } from './use-cloud.ts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

const EMPTY: CloudView = { steps: {} };
const CONFIGURED: CloudView = {
  steps: {
    corrector: {
      template: 'mistral',
      label: 'Mistral AI',
      baseUrl: 'https://api.mistral.ai/v1',
      host: 'api.mistral.ai',
      model: 'mistral-small-latest',
      loopback: false,
      confirmed: true,
      protection: false,
      key: 'system',
    },
  },
};
const INPUT: CloudInput = {
  template: 'mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  model: 'mistral-small-latest',
  key: 'fake-test-key',
  protection: null,
  protectionConfirmed: false,
};

function fakeClient(overrides: Partial<CloudClient> = {}): CloudClient {
  return {
    config: vi.fn<CloudClient['config']>(() => Promise.resolve(EMPTY)),
    use: vi.fn<CloudClient['use']>(() => Promise.resolve(CONFIGURED)),
    setKey: vi.fn<CloudClient['setKey']>(() => Promise.resolve(CONFIGURED)),
    setProtection: vi.fn<CloudClient['setProtection']>(() => Promise.resolve(CONFIGURED)),
    clear: vi.fn<CloudClient['clear']>(() => Promise.resolve(EMPTY)),
    check: vi.fn<CloudClient['check']>(() => Promise.resolve(undefined)),
    models: vi.fn<CloudClient['models']>(() => Promise.resolve([])),
    ...overrides,
  };
}

async function mount(client: CloudClient | null) {
  const latest: { current: CloudModel | null } = { current: null };
  function Probe() {
    const cloud = useCloud(client);
    useEffect(() => {
      latest.current = cloud;
    });
    return null;
  }
  await act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
  });
  if (latest.current === null) throw new Error('not mounted');
  return latest;
}

describe('useCloud', () => {
  it('is unavailable outside the desktop app', async () => {
    const cloud = await mount(null);
    expect(cloud.current?.available).toBe(false);
    expect(await cloud.current?.use('corrector', INPUT, false)).toEqual({
      state: 'error',
      error: 'notConfigured',
    });
  });

  it('asks for consent without checking the provider', async () => {
    const client = fakeClient({
      use: vi.fn<CloudClient['use']>(() => Promise.reject(new CloudCallError('consentMissing'))),
    });
    const cloud = await mount(client);
    expect(await cloud.current?.use('corrector', INPUT, false)).toEqual({ state: 'consent' });
    expect(client.check).not.toHaveBeenCalled();
  });

  it('checks a confirmed choice and shows it', async () => {
    const client = fakeClient({
      config: vi
        .fn<CloudClient['config']>()
        .mockResolvedValueOnce(EMPTY)
        .mockResolvedValue(CONFIGURED),
    });
    const cloud = await mount(client);
    let outcome;
    await act(async () => {
      outcome = await cloud.current?.use('corrector', INPUT, true);
    });
    expect(outcome).toEqual({ state: 'ok' });
    expect(client.use).toHaveBeenCalledWith('corrector', INPUT, true);
    expect(client.check).toHaveBeenCalledWith('corrector');
    expect(cloud.current?.steps.corrector?.label).toBe('Mistral AI');
  });

  it('switches the step off again when the check fails', async () => {
    const client = fakeClient({
      check: vi.fn<CloudClient['check']>(() => Promise.reject(new CloudCallError('auth'))),
    });
    const cloud = await mount(client);
    let outcome;
    await act(async () => {
      outcome = await cloud.current?.use('corrector', INPUT, true);
    });
    expect(outcome).toEqual({ state: 'error', error: 'auth' });
    expect(client.clear).toHaveBeenCalledWith('corrector');
    expect(cloud.current?.steps).toEqual({});
  });

  it('switches protection and reports which steps it protects', async () => {
    const protectedView: CloudView = {
      steps: { corrector: { ...CONFIGURED.steps.corrector!, protection: true } },
    };
    const client = fakeClient({
      config: vi.fn<CloudClient['config']>(() => Promise.resolve(protectedView)),
      setProtection: vi
        .fn<CloudClient['setProtection']>()
        .mockResolvedValueOnce(CONFIGURED)
        .mockRejectedValueOnce(new CloudCallError('protectionConsentMissing')),
    });
    const cloud = await mount(client);
    expect(cloud.current?.protects('corrector')).toBe(true);
    expect(cloud.current?.protects('reviewer')).toBe(false);
    await act(async () => {
      expect(await cloud.current?.setProtection('corrector', false, true)).toBeNull();
    });
    expect(client.setProtection).toHaveBeenCalledWith('corrector', false, true);
    expect(cloud.current?.protects('corrector')).toBe(false);
    await act(async () => {
      expect(await cloud.current?.setProtection('corrector', false, false)).toBe(
        'protectionConsentMissing',
      );
    });
  });

  it('lists models without storing anything and reports errors by class', async () => {
    const listed = [{ id: 'claude-x', displayName: 'Claude X' }];
    const client = fakeClient({
      models: vi
        .fn<CloudClient['models']>()
        .mockResolvedValueOnce(listed)
        .mockRejectedValueOnce(new CloudCallError('auth')),
    });
    const cloud = await mount(client);
    const input = { ...INPUT, template: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' };
    expect(await cloud.current?.models(input)).toEqual({ state: 'ok', models: listed });
    expect(client.models).toHaveBeenCalledWith(
      'anthropic',
      'https://api.anthropic.com/v1',
      'fake-test-key',
    );
    expect(await cloud.current?.models(input)).toEqual({ state: 'error', error: 'auth' });
    expect(client.use).not.toHaveBeenCalled();
  });
});
