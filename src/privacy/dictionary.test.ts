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

const everything: UnknownWords = async (words) => new Set(words);
const onlyMathelehrer: UnknownWords = async (words) =>
  new Set(words.filter((word) => /^mathelehrer$/iu.test(word)));
const nameEndings: UnknownWords = async (words) =>
  new Set(words.filter((word) => /(?:mann|berg)$/iu.test(word) && word.length > 8));

function unknownExcept(...known: string[]): UnknownWords {
  return async (asked) => new Set(asked.filter((word) => !known.includes(word)));
}

describe('findUnknownWordSpans with context', () => {
  it('marks an unknown word followed by a house number as place including the number', async () => {
    const lines = ['Wir wohnen in der AhortnalleK 21 seit Jahren.'];
    const spans = await findUnknownWordSpans(
      lines,
      undefined,
      unknownExcept('Wir', 'wir', 'Jahren', 'jahren'),
      signal,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]?.category).toBe('place');
    expect(
      lines[0]?.slice(spans[0]?.offset, (spans[0]?.offset ?? 0) + (spans[0]?.length ?? 0)),
    ).toBe('AhortnalleK 21');
  });

  it('marks an unknown word after a facility noun as institution including the facility', async () => {
    const lines = ['Mein Vater arbeitet im Autohaus Kleinschmidt seit zwei Jahren.'];
    const spans = await findUnknownWordSpans(
      lines,
      undefined,
      unknownExcept('Mein', 'mein', 'Vater', 'vater', 'Autohaus', 'autohaus', 'Jahren', 'jahren'),
      signal,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]?.category).toBe('institution');
    expect(
      lines[0]?.slice(spans[0]?.offset, (spans[0]?.offset ?? 0) + (spans[0]?.length ?? 0)),
    ).toBe('Autohaus Kleinschmidt');
  });

  it('checks a token with lowercase junk by its uppercase part and flags the whole token', async () => {
    const lines = ['Heute kam ocSelin zu Besuch.'];
    const asked: string[][] = [];
    const unknown: UnknownWords = async (words) => {
      asked.push([...words]);
      return new Set(['Selin', 'selin']);
    };
    expect(await found(lines, unknown)).toEqual(['ocSelin']);
    expect(asked[0]).toContain('Selin');
    expect(asked[0]).not.toContain('ocSelin');
  });

  it('never flags allowlisted words', async () => {
    const result = await found(['Ich nutze Instagram und feiere Ramadan.'], everything);
    expect(result).not.toContain('Instagram');
    expect(result).not.toContain('Ramadan');
  });

  it('does not flag an unknown compound whose parts are both known', async () => {
    expect(await found(['Mein Mathelehrer ist nett.'], onlyMathelehrer)).toEqual([]);
  });

  it('flags an unknown compound when one part is unknown too', async () => {
    expect(await found(['Mein Mathelehrer ist nett.'], everything)).toContain('Mathelehrer');
  });

  it('does not split words that end in a name ending', async () => {
    expect(await found(['Dort wohnt Hausermann und Sonnenberg.'], nameEndings)).toEqual([
      'Hausermann',
      'Sonnenberg',
    ]);
  });
});
