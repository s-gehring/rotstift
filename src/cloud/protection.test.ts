import { describe, expect, it } from 'vitest';
import type { CloudStep } from './client.ts';
import {
  protectionApplies,
  protectionDefault,
  protectionSuffix,
  stepProtectionDefault,
} from './protection.ts';

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

describe('protectionApplies', () => {
  it('is true only for a remote step with protection on', () => {
    const steps = { corrector: step(), reviewer: step({ protection: false }) };
    expect(protectionApplies(steps, 'corrector')).toBe(true);
    expect(protectionApplies(steps, 'reviewer')).toBe(false);
    expect(protectionApplies(steps, 'transcriber')).toBe(false);
  });
});

describe('protectionDefault', () => {
  it('is on for cloud providers and off for an own server and loopback', () => {
    expect(protectionDefault('mistral', 'https://api.mistral.ai/v1')).toBe(true);
    expect(protectionDefault('custom', 'https://ki.example/v1')).toBe(true);
    expect(protectionDefault('custom', 'http://localhost:8080/v1')).toBe(false);
    expect(protectionDefault('custom', 'http://127.0.0.1:8080/v1')).toBe(false);
    expect(protectionDefault('server', 'https://ki.schule.example/v1')).toBe(false);
    expect(stepProtectionDefault(step())).toBe(true);
    expect(stepProtectionDefault(step({ loopback: true }))).toBe(false);
    expect(stepProtectionDefault(step({ template: 'server' }))).toBe(false);
  });
});

describe('protectionSuffix', () => {
  it('names the protection for text steps and the lock for the recognition', () => {
    expect(protectionSuffix(step(), 'corrector')).toBe(', pseudonymisiert');
    expect(protectionSuffix(step(), 'transcriber')).toBe(', gesperrt durch den Schutz');
    expect(protectionSuffix(step({ protection: false }), 'corrector')).toBe('');
  });
});
