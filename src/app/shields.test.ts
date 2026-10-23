import { describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { CloudStep } from '../cloud/client.ts';
import { protectionApplies } from '../cloud/protection.ts';
import type { Corrector } from '../correction/corrector.ts';
import type { CorrectorStatus } from '../correction/provider.ts';
import { cloudShields, createShieldCorrector, previewShields } from './use-shields.ts';

const step = (overrides: Partial<CloudStep> = {}): CloudStep => ({
  template: 'mistral',
  label: 'Mistral AI',
  baseUrl: 'https://api.mistral.ai/v1',
  host: 'api.mistral.ai',
  model: 'm',
  loopback: false,
  confirmed: true,
  protection: true,
  key: 'system',
  ...overrides,
});

const PAGES = [{ pageId: 'p1', lines: ['Mia kam.'], spans: [] }] as const;

const signal = new AbortController().signal;

function cloud(steps: Partial<Record<'corrector' | 'reviewer', CloudStep>>) {
  return {
    steps,
    protects: (role: 'transcriber' | 'corrector' | 'reviewer') => protectionApplies(steps, role),
  };
}

describe('cloudShields', () => {
  it('shields every protected cloud text step and nothing else', () => {
    const create = vi.fn<() => Corrector>(() => ({ correct: vi.fn<Corrector['correct']>() }));
    const shields = cloudShields(
      cloud({ corrector: step(), reviewer: step({ protection: false }) }),
      create,
    );
    expect(shields.corrector).toBeTypeOf('function');
    expect(shields.reviewer).toBeUndefined();
    expect(create).toHaveBeenCalledWith(step(), 'corrector');
  });

  it('shields nothing without a usable cloud step', () => {
    expect(cloudShields(cloud({}))).toEqual({});
    expect(cloudShields(cloud({ corrector: step({ confirmed: false }) }))).toEqual({});
  });

  it('wraps the shielded corrector so that it only sees known lines', async () => {
    const correct = vi.fn<Corrector['correct']>(() =>
      Promise.resolve({ ok: true, correctedText: 'x' }),
    );
    const shields = cloudShields(cloud({ corrector: step() }), () => ({ correct }));
    const result = await shields.corrector?.(PAGES).correct(['Fremd.'], DEUTSCH, signal);
    expect(result).toMatchObject({ ok: false });
    expect(correct).not.toHaveBeenCalled();
  });
});

describe('createShieldCorrector', () => {
  it('marks every cloud request as pseudonymized', async () => {
    const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<never>>(() =>
      Promise.reject(new Error('offline')),
    );
    await createShieldCorrector(step(), 'corrector', invoke).correct(['Mia kam.'], DEUTSCH, signal);
    expect(invoke).toHaveBeenCalledWith(
      'cloud_chat',
      expect.objectContaining({ step: 'corrector', pseudonymized: true }),
    );
  });
});

describe('previewShields', () => {
  it('wraps the ready preview models', () => {
    const ready: CorrectorStatus = {
      state: 'ready',
      corrector: { correct: vi.fn<Corrector['correct']>() },
      preview: true,
    };
    const shields = previewShields(ready, { state: 'needs-model', message: 'fehlt' });
    expect(shields.corrector).toBeTypeOf('function');
    expect(shields.reviewer).toBeUndefined();
  });
});
