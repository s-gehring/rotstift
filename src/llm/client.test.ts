import { describe, expect, it } from 'vitest';
import { LlmCallError, createLlmClient, visionMessage } from './client.ts';
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

const response = (content: string | null, finishReason: string | null = 'stop'): ChatResponse => ({
  choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content } }],
});

describe('createLlmClient', () => {
  it('starts the runtime with a registry model id only', async () => {
    const { calls, invoke } = fakeInvoke({ state: 'ready', model: 'm.gguf', port: 1 });
    const status = await createLlmClient(invoke).startModel('qwen');
    expect(status).toEqual({ state: 'ready', model: 'm.gguf', port: 1 });
    expect(calls).toEqual([['llm_start_model', { modelId: 'qwen' }]]);
  });

  it('wraps runtime errors in LlmCallError', async () => {
    const { invoke } = fakeInvoke({ kind: 'modelNotFound', detail: 'm.gguf' }, true);
    const result = createLlmClient(invoke).startModel('qwen');
    await expect(result).rejects.toBeInstanceOf(LlmCallError);
    await expect(result).rejects.toMatchObject({
      error: { kind: 'modelNotFound', detail: 'm.gguf' },
    });
  });

  it('passes other failures through unchanged', async () => {
    const { invoke } = fakeInvoke('command llm_status not found', true);
    await expect(createLlmClient(invoke).status()).rejects.toBe('command llm_status not found');
  });

  it('returns the text and the finish reason of the first choice', async () => {
    const { calls, invoke } = fakeInvoke(response('Hallo'));
    const request = { messages: [{ role: 'user' as const, content: 'Sag Hallo' }] };
    await expect(createLlmClient(invoke).complete(request)).resolves.toEqual({
      text: 'Hallo',
      finishReason: 'stop',
    });
    expect(calls).toEqual([['llm_chat', { request }]]);
  });

  it('reports a truncated answer through its finish reason', async () => {
    const { invoke } = fakeInvoke(response('Abgeschnitten', 'length'));
    await expect(createLlmClient(invoke).complete({ messages: [] })).resolves.toEqual({
      text: 'Abgeschnitten',
      finishReason: 'length',
    });
    const missing = fakeInvoke(response('Text', null));
    await expect(createLlmClient(missing.invoke).complete({ messages: [] })).resolves.toEqual({
      text: 'Text',
      finishReason: null,
    });
  });

  it('returns the token log probabilities of the first choice when the server sends them', async () => {
    const tokens = [{ token: 'Hal', bytes: [72, 97, 108], logprob: -0.1 }];
    const withTokens: ChatResponse = {
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Hal' },
          logprobs: { content: tokens },
        },
      ],
    };
    const { invoke } = fakeInvoke(withTokens);
    await expect(createLlmClient(invoke).complete({ messages: [] })).resolves.toEqual({
      text: 'Hal',
      finishReason: 'stop',
      logprobs: tokens,
    });
  });

  it('cancels the request in the runtime when the signal aborts', async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const invoke: Invoke = (command, args) => {
      calls.push([command, args]);
      if (command === 'llm_cancel') return Promise.resolve(JSON.parse('true'));
      return new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject({ kind: 'cancelled' });
        });
      });
    };
    const controller = new AbortController();
    const request = { messages: [{ role: 'user' as const, content: 'x' }] };
    const result = createLlmClient(invoke).chat(request, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const [chat, cancel] = calls;
    expect(chat?.[0]).toBe('llm_chat');
    expect(cancel).toEqual(['llm_cancel', { requestId: chat?.[1]?.['requestId'] }]);
    expect(typeof chat?.[1]?.['requestId']).toBe('string');
  });

  it('does not call the runtime when the signal is already aborted', async () => {
    const { calls, invoke } = fakeInvoke(response('Hallo'));
    const signal = AbortSignal.abort();
    await expect(createLlmClient(invoke).chat({ messages: [] }, { signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(calls).toEqual([]);
  });

  it('fails when the response has no message text', async () => {
    const { invoke } = fakeInvoke(response(null));
    await expect(createLlmClient(invoke).complete({ messages: [] })).rejects.toBeInstanceOf(
      LlmCallError,
    );
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
