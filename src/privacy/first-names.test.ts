import { describe, expect, it } from 'vitest';
import { detectFirstNames, findFirstNameSpans, taskWords } from './first-names.ts';

function found(lines: readonly string[], task?: string) {
  return findFirstNameSpans(lines, task).map((span) =>
    (lines[span.line - 1] ?? '').slice(span.offset, span.offset + span.length),
  );
}

describe('findFirstNameSpans', () => {
  it('finds listed first names anywhere in the text', () => {
    expect(found(['Gestern war Lukas mit Sophie im Park.'])).toEqual(['Lukas', 'Sophie']);
  });

  it('marks list hits as name-list and person', () => {
    const [span] = findFirstNameSpans(['Lukas kam.']);
    expect(span).toMatchObject({
      kind: 'identifier',
      category: 'person',
      source: 'name-list',
      line: 1,
      offset: 0,
      length: 5,
    });
  });

  it('keeps the genitive s and apostrophe outside the span', () => {
    expect(found(['Lukas Hund und Hannes’ Katze, Annas Buch'])).toEqual([
      'Lukas',
      'Hannes',
      'Anna',
    ]);
  });

  it('skips short lowercase words that are also names', () => {
    expect(found(['ich bin ein tim und ein Tim'])).toEqual(['Tim']);
  });

  it('skips hyphenated words', () => {
    expect(found(['Anna-Lena kam'])).toEqual([]);
  });

  it('finds names after a trigger word even when unlisted', () => {
    expect(found(['Hallo Zorbek, ich schreibe dir.'])).toEqual(['Zorbek']);
    expect(found(['Meine Oma Gertraude ist nett.'])).toEqual(['Gertraude']);
    expect(found(['Herr Quandt unterrichtet.'])).toEqual(['Quandt']);
  });

  it('accepts a lowercase name after a naming trigger only', () => {
    expect(found(['ich heiße zorbek'])).toEqual(['zorbek']);
    expect(found(['hallo zorbek'])).toEqual([]);
  });

  it('ignores common words after a trigger', () => {
    expect(found(['Meine Oma und mein Opa'])).toEqual([]);
    expect(found(['Liebe Grüße'])).toEqual([]);
  });

  it('returns spans on the correct line', () => {
    const spans = findFirstNameSpans(['Erste Zeile.', 'Dann kam Jonas.']);
    expect(spans.map((span) => [span.line, span.offset])).toEqual([[2, 9]]);
  });

  it('ignores words that appear in the task', () => {
    expect(found(['Maria Stuart war Königin.'], 'Erläutere Maria Stuart.')).toEqual([]);
    expect(found(['Maria war Königin.'])).toEqual(['Maria']);
  });

  it('returns nothing for text without names', () => {
    expect(found(['Der Hund läuft über die Wiese.'])).toEqual([]);
    expect(found([])).toEqual([]);
  });
});

describe('taskWords', () => {
  it('collects capitalized words in lowercase form', () => {
    expect([...taskWords('Beschreibe Goethes Leben in Weimar')]).toEqual([
      'beschreibe',
      'goethes',
      'leben',
      'weimar',
    ]);
  });

  it('is empty for missing or empty tasks', () => {
    expect(taskWords(undefined).size).toBe(0);
    expect(taskWords('').size).toBe(0);
  });
});

describe('detectFirstNames', () => {
  const context = { workName: 'x', language: 'de' };

  it('returns the spans for the given lines and task', async () => {
    const spans = await detectFirstNames(
      ['Lukas und Maria'],
      { ...context, task: 'Maria' },
      new AbortController().signal,
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ offset: 0, length: 5 });
  });

  it('rejects when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(detectFirstNames(['Lukas'], context, controller.signal)).rejects.toThrow(/abort/i);
  });
});
