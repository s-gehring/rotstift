import { describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { DEFAULT_SCOPE } from '../correction/scope.ts';
import { LlmCallError } from '../llm/client.ts';
import type { ChatOptions, Completion } from '../llm/client.ts';
import type { ChatRequest } from '../llm/types.ts';
import { createLlmReviewer } from './llm-reviewer.ts';
import type { ContentInput } from './review.ts';

type Complete = (request: ChatRequest, options?: ChatOptions) => Promise<Completion>;

const input: ContentInput = {
  lines: [
    { pageId: 'p1', line: 1, text: 'Hallo Welt' },
    { pageId: 'p1', line: 2, text: 'Tschüss' },
  ],
  profile: DEUTSCH,
  scope: {
    ...DEFAULT_SCOPE,
    spelling: false,
    grammar: false,
    content: true,
    assignment: 'Schreibe.',
  },
};

const unmet = JSON.stringify({ erfuellt: false, zeile: 2, kommentar: 'Thema verfehlt' });

function clientReturning(text: string, finishReason: string | null = 'stop') {
  const complete = vi.fn<Complete>(() => Promise.resolve({ text, finishReason }));
  return { client: { complete }, complete };
}

describe('createLlmReviewer', () => {
  it('asks with temperature 0 and a json schema named antwort', async () => {
    const { client, complete } = clientReturning(unmet);
    const result = await createLlmReviewer({ client }).review(input, new AbortController().signal);
    expect(result.ok).toBe(true);
    const request = complete.mock.calls[0]?.[0];
    expect(request?.temperature).toBe(0);
    expect(request?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'antwort' },
    });
  });

  it('returns the parsed comments', async () => {
    const { client } = clientReturning(unmet);
    const result = await createLlmReviewer({ client }).review(input, new AbortController().signal);
    expect(result).toEqual({
      ok: true,
      comments: [{ pageId: 'p1', line: 2, kind: 'content', text: 'Thema verfehlt' }],
      questions: 2,
    });
  });

  it('runs prepare before asking', async () => {
    const { client, complete } = clientReturning(unmet);
    const prepare = vi.fn<() => Promise<void>>(() => {
      expect(complete).not.toHaveBeenCalled();
      return Promise.resolve();
    });
    await createLlmReviewer({ client, prepare }).review(input, new AbortController().signal);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('treats a truncated answer as invalid', async () => {
    const { client } = clientReturning(unmet, 'length');
    const result = await createLlmReviewer({ client }).review(input, new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Das Modell hat keine gültigen Antworten geliefert' },
    });
  });

  it('maps runtime errors through describeLlmError', async () => {
    const complete = vi.fn<Complete>(() => Promise.reject(new LlmCallError({ kind: 'timeout' })));
    const result = await createLlmReviewer({ client: { complete } }).review(
      input,
      new AbortController().signal,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Die Korrektur hat zu lange gedauert' },
    });
  });

  it('reports other errors as failed', async () => {
    const complete = vi.fn<Complete>(() => Promise.reject(new Error('boom')));
    const result = await createLlmReviewer({ client: { complete } }).review(
      input,
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'failed', message: 'boom' } });
  });

  it('is cancelled when the signal is already aborted', async () => {
    const { client, complete } = clientReturning(unmet);
    const controller = new AbortController();
    controller.abort();
    const result = await createLlmReviewer({ client }).review(input, controller.signal);
    expect(result).toEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(complete).not.toHaveBeenCalled();
  });

  it('is cancelled when aborted during a request', async () => {
    const controller = new AbortController();
    const complete = vi.fn<Complete>(() => {
      controller.abort();
      return Promise.reject(new Error('aborted'));
    });
    const result = await createLlmReviewer({ client: { complete } }).review(
      input,
      controller.signal,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'cancelled' } });
  });
});
