import { describe, expect, it, vi } from 'vitest';
import {
  createDictionaryDetector,
  findUnknownWordSpans,
  wordForms,
  type UnknownWords,
} from './dictionary.ts';

const signal = new AbortController().signal;

function unknownSet(...words: string[]): UnknownWords {
  return async () => new Set(words);
}

async function found(lines: readonly string[], unknown: UnknownWords, task?: string) {
  const spans = await findUnknownWordSpans(lines, task, unknown, signal);
  return spans.map((span) =>
    (lines[span.line - 1] ?? '').slice(span.offset, span.offset + span.length),
  );
}

describe('wordForms', () => {
  it('lists original, lowercase and capitalized forms', () => {
    expect(wordForms('ZORBEK')).toEqual(['ZORBEK', 'zorbek', 'Zorbek']);
  });

  it('adds the form without a trailing s', () => {
    expect(wordForms('Zorbeks')).toEqual(['Zorbeks', 'zorbeks', 'Zorbek']);
  });

  it('strips genitive apostrophes', () => {
    expect(wordForms("Hans'")).toEqual(['Hans', 'hans', 'Han']);
    expect(wordForms('Zorbek’s')).toEqual(['Zorbek', 'zorbek']);
  });
});

describe('findUnknownWordSpans', () => {
  it('marks capitalized words whose forms are all unknown as person', async () => {
    const lines = ['Gestern traf ich Zorbek im Park.'];
    const spans = await findUnknownWordSpans(
      lines,
      undefined,
      unknownSet('Zorbek', 'zorbek'),
      signal,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      kind: 'identifier',
      category: 'person',
      source: 'rule',
      line: 1,
      offset: 17,
      length: 6,
    });
  });

  it('keeps words with at least one known form', async () => {
    expect(await found(['Zorbek kam.'], unknownSet('Zorbek'))).toEqual([]);
  });

  it('ignores lowercase words', async () => {
    expect(await found(['zorbek kam.'], unknownSet('zorbek', 'Zorbek'))).toEqual([]);
  });

  it('skips words shorter than three letters', async () => {
    const unknown = unknownSet('Zo', 'zo', 'Zorbek', 'zorbek');
    expect(await found(['Zo und Zorbek'], unknown)).toEqual(['Zorbek']);
  });

  it('skips words from the task', async () => {
    const unknown = unknownSet('Zorbek', 'zorbek', 'Quandt', 'quandt');
    expect(await found(['Zorbek und Quandt'], unknown, 'Beschreibe Zorbek')).toEqual(['Quandt']);
  });

  it('skips task words regardless of case', async () => {
    const unknown = unknownSet('Zorbek', 'zorbek', 'ZORBEK');
    expect(await found(['ZORBEK kam'], unknown, 'zorbek')).toEqual([]);
  });

  it('asks the lookup once with the unique forms of all candidates', async () => {
    const lookup = vi.fn<UnknownWords>(async () => new Set<string>());
    await findUnknownWordSpans(['Zorbek sah Zorbek.', 'Quandt kam'], undefined, lookup, signal);
    expect(lookup).toHaveBeenCalledTimes(1);
    const forms = lookup.mock.calls[0]?.[0] ?? [];
    expect([...forms].toSorted()).toEqual(['Quandt', 'Zorbek', 'quandt', 'zorbek']);
  });

  it('does not call the lookup without candidates', async () => {
    const lookup = vi.fn<UnknownWords>(async () => new Set<string>());
    expect(await findUnknownWordSpans(['der hund läuft'], undefined, lookup, signal)).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('reports every occurrence with its line', async () => {
    const lines = ['Zorbek kam.', 'Dann ging Zorbek.'];
    const spans = await findUnknownWordSpans(
      lines,
      undefined,
      unknownSet('Zorbek', 'zorbek'),
      signal,
    );
    expect(spans.map((span) => [span.line, span.offset])).toEqual([
      [1, 0],
      [2, 10],
    ]);
  });
});

describe('createDictionaryDetector', () => {
  const context = { workName: 'x', language: 'de', task: 'Quandt' };

  it('passes the task from the context', async () => {
    const detector = createDictionaryDetector(unknownSet('Zorbek', 'zorbek', 'Quandt', 'quandt'));
    const spans = await detector(['Zorbek Quandt'], context, signal);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ offset: 0, length: 6 });
  });

  it('rejects when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const detector = createDictionaryDetector(unknownSet());
    await expect(detector(['Zorbek'], context, controller.signal)).rejects.toThrow(/abort/i);
  });
});
