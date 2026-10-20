import { describe, expect, it, vi } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import { LlmCallError } from '../llm/client.ts';
import type { ChatOptions, Completion } from '../llm/client.ts';
import type { ChatRequest, LlmError } from '../llm/types.ts';
import {
  cleanAnswer,
  createLlmCorrector,
  numberLines,
  readNumberedLines,
  renderPrompt,
} from './llm-corrector.ts';
import type { CorrectorConfig } from './llm-corrector.ts';

const config: CorrectorConfig = {
  promptTemplate: 'Fach: {subject}, Sprache: {language}\n---\n{text}',
  lineMode: 'plain',
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
    ).toThrow('{text}');
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

const numbered: CorrectorConfig = {
  system: 'Du korrigierst. Fach: {subject}.',
  promptTemplate: '{text}',
  lineMode: 'numbered',
  maxOutputTokens: 512,
  temperature: 0,
};

describe('numbered lines', () => {
  it('numbers by line position and skips empty lines', () => {
    expect(numberLines(['Er kam', '', 'spät.'])).toBe('1: Er kam\n3: spät.');
  });

  it('reads the corrected lines back without their numbers', () => {
    expect(readNumberedLines(['Er kam', '', 'spät'], '1: Er kam,\n3. Spät.')).toEqual({
      correctedText: 'Er kam,\n\nSpät.',
      issues: [],
    });
  });

  it('reports missing lines and ignores unknown numbers and duplicates', () => {
    const read = readNumberedLines(['a', 'b'], '1: x\n1: y\n7: z');
    expect(read.issues).toEqual(['Zeile 2 fehlt in der Ausgabe.']);
  });

  it('drops emphasis asterisks the model added', () => {
    expect(
      readNumberedLines(['von lateinisch scala'], '1: von lateinisch *scala*').correctedText,
    ).toBe('von lateinisch scala');
    expect(readNumberedLines(['Fußnote*'], '1: Fußnote*').correctedText).toBe('Fußnote*');
  });

  it('keeps numbers inside the line text', () => {
    expect(readNumberedLines(['Am 12. März'], '1: Am 12. März').correctedText).toBe('Am 12. März');
  });
});

describe('createLlmCorrector in numbered mode', () => {
  it('sends system and numbered lines and returns text without numbers', async () => {
    const { client, complete } = clientReturning('1: Er kam\n2: spät.');
    const result = await createLlmCorrector({ client, config: numbered }).correct(
      ['Er kam', 'spät.'],
      DEUTSCH,
      signal(),
    );
    expect(result).toEqual({ ok: true, correctedText: 'Er kam\nspät.' });
    expect(complete.mock.calls[0]?.[0].messages).toEqual([
      { role: 'system', content: 'Du korrigierst. Fach: Deutsch.' },
      { role: 'user', content: '1: Er kam\n2: spät.' },
    ]);
  });

  it('asks again once when lines are missing', async () => {
    const complete = vi
      .fn<Complete>()
      .mockResolvedValueOnce({ text: '1: Er kam', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: '1: Er kam\n2: spät.', finishReason: 'stop' });
    const result = await createLlmCorrector({ client: { complete }, config: numbered }).correct(
      ['Er kam', 'spät'],
      DEUTSCH,
      signal(),
    );
    expect(result).toEqual({ ok: true, correctedText: 'Er kam\nspät.' });
    expect(complete).toHaveBeenCalledTimes(2);
    const repair = complete.mock.calls[1]?.[0].messages;
    expect(repair?.slice(-2)).toEqual([
      { role: 'assistant', content: '1: Er kam' },
      {
        role: 'user',
        content:
          'Die Ausgabe ist nicht gültig:\n- Zeile 2 fehlt in der Ausgabe.\nGib alle Zeilen noch einmal mit ihrer Nummer aus.',
      },
    ]);
  });

  it('fails when lines are still missing after the repair', async () => {
    const { client, complete } = clientReturning('1: Er kam');
    const result = await createLlmCorrector({ client, config: numbered }).correct(
      ['Er kam', 'spät'],
      DEUTSCH,
      signal(),
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Die Antwort des Modells enthält nicht alle Zeilen' },
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
