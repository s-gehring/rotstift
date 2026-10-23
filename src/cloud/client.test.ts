import { describe, expect, it } from 'vitest';
import { CloudCallError, createCloudClient, type CloudInput, type Invoke } from './client.ts';

const INPUT: CloudInput = {
  template: 'mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  model: 'm',
  key: null,
  protection: false,
  protectionConfirmed: true,
};

type Call = readonly [string, Record<string, unknown> | undefined];

function recording() {
  const calls: Call[] = [];
  const invoke: Invoke = (command, args) => {
    calls.push([command, args]);
    return Promise.resolve(JSON.parse('{"steps":{}}'));
  };
  return { calls, client: createCloudClient(invoke) };
}

const rejecting: Invoke = () =>
  Promise.reject({ kind: 'cloud', detail: 'protectionConsentMissing' });

describe('createCloudClient', () => {
  it('sends the protection choice and its confirmation with the choice', async () => {
    const { calls, client } = recording();
    await client.use('corrector', INPUT, true);
    expect(calls).toEqual([['cloud_use', { step: 'corrector', ...INPUT, confirmed: true }]]);
  });

  it('switches protection through its own command', async () => {
    const { calls, client } = recording();
    await client.setProtection('reviewer', false, true);
    expect(calls).toEqual([
      ['cloud_set_protection', { step: 'reviewer', protection: false, confirmed: true }],
    ]);
  });

  it('turns the new error classes into call errors', async () => {
    const client = createCloudClient(rejecting);
    await expect(client.setProtection('corrector', false, false)).rejects.toEqual(
      new CloudCallError('protectionConsentMissing'),
    );
  });
});
