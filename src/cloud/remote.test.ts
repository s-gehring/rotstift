import { describe, expect, it } from 'vitest';
import type { Invoke } from '../llm/client.ts';
import type { CloudStep } from './client.ts';
import {
  cloudBlockedMessage,
  cloudLlmClient,
  cloudUsable,
  remoteCorrector,
  remoteEngine,
  remoteTranscriber,
} from './remote.ts';

const step = (overrides: Partial<CloudStep> = {}): CloudStep => ({
  template: 'mistral',
  label: 'Mistral AI',
  baseUrl: 'https://api.mistral.ai/v1',
  host: 'api.mistral.ai',
  model: 'pixtral-12b',
  loopback: false,
  confirmed: true,
  protection: false,
  key: 'system',
  ...overrides,
});

function recording() {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const invoke: Invoke = (command, args) => {
    calls.push([command, args]);
    return command === 'cloud_chat'
      ? new Promise(() => undefined)
      : Promise.resolve(JSON.parse('null'));
  };
  return { calls, invoke };
}

describe('cloudLlmClient', () => {
  it('sends chats and cancels through the cloud commands with the step', () => {
    const { calls, invoke } = recording();
    const controller = new AbortController();
    void cloudLlmClient('corrector', invoke).chat({ messages: [] }, { signal: controller.signal });
    controller.abort();
    const [chat, cancel] = calls;
    expect(chat?.[0]).toBe('cloud_chat');
    expect(chat?.[1]).toMatchObject({ step: 'corrector', request: { messages: [] } });
    expect(cancel).toEqual(['cloud_cancel', { requestId: chat?.[1]?.['requestId'] }]);
    expect(calls.some(([command]) => command.startsWith('llm_'))).toBe(false);
  });

  it('marks a request as pseudonymized only when asked to', () => {
    const { calls, invoke } = recording();
    void cloudLlmClient('corrector', invoke).chat({ messages: [] });
    void cloudLlmClient('corrector', invoke, { pseudonymized: true }).chat({ messages: [] });
    expect(calls.map(([, args]) => args?.['pseudonymized'])).toEqual([false, true]);
  });
});

describe('remote models', () => {
  it('needs no local engine', async () => {
    const lease = await remoteEngine().acquire(
      remoteTranscriber(step()),
      new AbortController().signal,
    );
    expect(lease.startupMs).toBe(0);
    expect(remoteEngine().monitor('cloud-transcriber').getPhase()).toBe('ready');
  });

  it('never marks words as uncertain for cloud recognition', () => {
    const model = remoteTranscriber(step());
    expect(model.request.uncertainBelow).toBeNull();
    expect(model.displayName).toBe('Mistral AI · pixtral-12b');
    expect(remoteCorrector(step(), 'reviewer').id).toBe('cloud-reviewer');
  });
});

describe('cloudUsable', () => {
  it('needs a confirmed step and a key where the provider requires one', () => {
    expect(cloudUsable(undefined)).toBe(false);
    expect(cloudUsable(step())).toBe(true);
    expect(cloudUsable(step({ confirmed: false }))).toBe(false);
    expect(cloudUsable(step({ key: null }))).toBe(false);
    expect(cloudUsable(step({ template: 'server', key: null }))).toBe(true);
  });

  it('never uses a recognition in the cloud while protection is on', () => {
    expect(cloudUsable(step({ protection: true }), 'transcriber')).toBe(false);
    expect(cloudUsable(step({ protection: false }), 'transcriber')).toBe(true);
    expect(cloudUsable(step({ protection: true }), 'corrector')).toBe(true);
  });

  it('explains a recognition that the protection blocks', () => {
    const message = cloudBlockedMessage(step({ protection: true }), 'transcriber');
    expect(message).toContain('Bei eingeschaltetem Schutz läuft die Erkennung lokal.');
    expect(message).toContain('Mistral AI');
    expect(cloudBlockedMessage(step({ protection: true, key: null }), 'corrector')).toContain(
      'fehlt der Schlüssel',
    );
  });

  it('explains why a step is blocked', () => {
    expect(cloudBlockedMessage(step({ key: null }))).toContain('fehlt der Schlüssel');
    expect(cloudBlockedMessage(step({ confirmed: false }))).toContain('nicht freigegeben');
  });
});
