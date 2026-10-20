import { describe, expect, it, vi } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import { LlmCallError } from '../llm/client.ts';
import type { ChatOptions, Completion } from '../llm/client.ts';
import type { ChatRequest, LlmError } from '../llm/types.ts';
import { cleanAnswer, createLlmCorrector, renderPrompt } from './llm-corrector.ts';
import type { CorrectorConfig } from './llm-corrector.ts';

const config: CorrectorConfig = {
  promptTemplate: 'Fach: {{subject}}, Sprache: {{language}}\n---\n{{text}}',
  maxOutputTokens: 512,
  temperature: 0.1,
};

type Complete = (request: ChatRequest, options?: ChatOptions) => Promise<Completion>;

function clientReturning(text: string, finishReason: string | null = 'stop') {
  const complete = vi.fn<Complete>(() => Promise.resolve({ text, finishReason }));
  return { client: { complete }, complete };
}

function clientFailing(error: unknown) {
  const complete = vi.fn<Complete>(() => Promise.reject(error));
  return { client: { complete }, complete };
}

const signal = () => new AbortController().signal;

describe('renderPrompt', () => {
  it('fills the placeholders without interpreting replacement patterns', () => {
    expect(
      renderPrompt(config.promptTemplate, {
        text: 'Preis $& 5',
        subject: 'Deutsch',
        language: 'Deutsch',
      }),
    ).toBe('Fach: Deutsch, Sprache: Deutsch\n---\nPreis $& 5');
  });
});

describe('cleanAnswer', () => {
  it('removes code fences and thinking blocks', () => {
    expect(cleanAnswer('```text\nHallo Welt\n```')).toBe('Hallo Welt');
    expect(cleanAnswer('<think>hm</think>\nHallo Welt  ')).toBe('Hallo Welt');
  });

  it('reports an unfinished thinking block', () => {
    expect(cleanAnswer('<think>hm')).toBeNull();
  });
});

describe('createLlmCorrector', () => {
  it('sends the rendered prompt with the configured limits', async () => {
    const { client, complete } = clientReturning('Hallo Welt.');
    const corrector = createLlmCorrector({ client, config });
    const result = await corrector.correct(['Hallo Welt', 'zweite Zeile'], ENGLISCH, signal());
    expect(result).toEqual({ ok: true, correctedText: 'Hallo Welt.' });
    expect(complete).toHaveBeenCalledOnce();
    const request = complete.mock.calls[0]?.[0];
    expect(request?.messages).toEqual([
      {
        role: 'user',
        content: 'Fach: Englisch, Sprache: Englisch\n---\nHallo Welt\nzweite Zeile',
      },
    ]);
    expect(request?.temperature).toBe(0.1);
    expect(request?.max_tokens).toBe(512);
  });

  it('runs prepare before asking the model', async () => {
    const order: string[] = [];
    const complete = vi.fn<Complete>(() => {
      order.push('complete');
      return Promise.resolve({ text: 'x', finishReason: 'stop' });
    });
    const corrector = createLlmCorrector({
      client: { complete },
      config,
      prepare: () => {
        order.push('prepare');
        return Promise.resolve();
      },
    });
    await corrector.correct(['x'], DEUTSCH, signal());
    expect(order).toEqual(['prepare', 'complete']);
  });

  it('rejects a template without the text placeholder', () => {
    const { client } = clientReturning('x');
    expect(() =>
      createLlmCorrector({ client, config: { ...config, promptTemplate: 'nichts' } }),
    ).toThrow('{{text}}');
  });

  it('reports a cut off answer', async () => {
    const { client } = clientReturning('Hallo', 'length');
    const result = await createLlmCorrector({ client, config }).correct(['x'], DEUTSCH, signal());
    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Die Antwort des Modells war unvollständig' },
    });
  });

  it('reports an empty answer', async () => {
    const { client } = clientReturning('  ');
    const result = await createLlmCorrector({ client, config }).correct(['x'], DEUTSCH, signal());
    expect(result).toMatchObject({ ok: false, error: { kind: 'failed' } });
  });

  it.each<[LlmError, string]>([
    [{ kind: 'modelNotFound', detail: 'x' }, 'unavailable'],
    [{ kind: 'sidecarMissing', detail: 'x' }, 'unavailable'],
    [{ kind: 'timeout' }, 'failed'],
    [{ kind: 'server', detail: { status: 500, body: '' } }, 'failed'],
    [{ kind: 'cancelled' }, 'cancelled'],
  ])('maps %o to %s', async (error, kind) => {
    const { client } = clientFailing(new LlmCallError(error));
    const result = await createLlmCorrector({ client, config }).correct(['x'], DEUTSCH, signal());
    expect(result).toMatchObject({ ok: false, error: { kind } });
  });

  it('reports cancellation when the signal is aborted', async () => {
    const controller = new AbortController();
    const { client } = clientFailing(new Error('abgebrochen'));
    controller.abort();
    const result = await createLlmCorrector({ client, config }).correct(
      ['x'],
      DEUTSCH,
      controller.signal,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'cancelled' } });
  });

  it('reports unexpected errors as failed', async () => {
    const { client } = clientFailing(new Error('kaputt'));
    const result = await createLlmCorrector({ client, config }).correct(['x'], DEUTSCH, signal());
    expect(result).toEqual({ ok: false, error: { kind: 'failed', message: 'kaputt' } });
  });
});
