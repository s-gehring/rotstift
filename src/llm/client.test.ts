import { describe, expect, it } from 'vitest';
import { LlmCallError, createLlmClient, imageDataUrl, visionMessage } from './client.ts';
import type { Invoke } from './client.ts';
import type { ChatResponse } from './types.ts';

function fakeInvoke(result: unknown, fail = false) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const invoke: Invoke = (command, args) => {
    calls.push([command, args]);
    return fail ? Promise.reject(result) : Promise.resolve(JSON.parse(JSON.stringify(result)));
  };
  return { calls, invoke };
}

const response = (content: string | null): ChatResponse => ({
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
});

describe('createLlmClient', () => {
  it('starts the runtime with the given options', async () => {
    const { calls, invoke } = fakeInvoke({ state: 'ready', model: 'm.gguf', port: 1 });
    const status = await createLlmClient(invoke).start({ model: 'm.gguf', contextSize: 4096 });
    expect(status).toEqual({ state: 'ready', model: 'm.gguf', port: 1 });
    expect(calls).toEqual([['llm_start', { options: { model: 'm.gguf', contextSize: 4096 } }]]);
  });

  it('wraps runtime errors in LlmCallError', async () => {
    const { invoke } = fakeInvoke({ kind: 'modelNotFound', detail: 'm.gguf' }, true);
    const result = createLlmClient(invoke).start({ model: 'm.gguf' });
    await expect(result).rejects.toBeInstanceOf(LlmCallError);
    await expect(result).rejects.toMatchObject({
      error: { kind: 'modelNotFound', detail: 'm.gguf' },
    });
  });

  it('passes other failures through unchanged', async () => {
    const { invoke } = fakeInvoke('command llm_status not found', true);
    await expect(createLlmClient(invoke).status()).rejects.toBe('command llm_status not found');
  });

  it('returns the text of the first choice', async () => {
    const { calls, invoke } = fakeInvoke(response('Hallo'));
    const request = { messages: [{ role: 'user' as const, content: 'Sag Hallo' }] };
    await expect(createLlmClient(invoke).complete(request)).resolves.toBe('Hallo');
    expect(calls).toEqual([['llm_chat', { request }]]);
  });

  it('fails when the response has no message text', async () => {
    const { invoke } = fakeInvoke(response(null));
    await expect(createLlmClient(invoke).complete({ messages: [] })).rejects.toBeInstanceOf(
      LlmCallError,
    );
  });
});

describe('imageDataUrl', () => {
  it('encodes bytes as a base64 data URL', () => {
    expect(imageDataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png')).toBe(
      'data:image/png;base64,iVBORw==',
    );
  });

  it('encodes images larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 256);
    const url = imageDataUrl(bytes, 'image/jpeg');
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const decoded = atob(url.slice(url.indexOf(',') + 1));
    expect(Uint8Array.from(decoded, (char) => char.charCodeAt(0))).toEqual(bytes);
  });
});

describe('visionMessage', () => {
  it('puts the images before the prompt', () => {
    expect(visionMessage('Transkribiere.', ['data:a', 'data:b'])).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:a' } },
        { type: 'image_url', image_url: { url: 'data:b' } },
        { type: 'text', text: 'Transkribiere.' },
      ],
    });
  });
});
