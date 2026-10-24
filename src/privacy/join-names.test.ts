import { describe, expect, it } from 'vitest';
import { joinNames, withoutNounUses } from './join-names.ts';
import type { IdentifierSpan, PrivacySpan } from './types.ts';

function person(lines: readonly string[], text: string, from = 0): IdentifierSpan {
  const line = lines.findIndex((entry, index) => index >= from && entry.includes(text));
  return {
    kind: 'identifier',
    category: 'person',
    source: 'rule',
    line: line + 1,
    offset: (lines[line] ?? '').indexOf(text),
    length: text.length,
  };
}

function texts(lines: readonly string[], spans: readonly PrivacySpan[]) {
  return spans.map((span) =>
    (lines[span.line - 1] ?? '').slice(span.offset, span.offset + span.length).trim(),
  );
}

describe('joinNames', () => {
  it('adds a word surname after a person span', () => {
    const lines = ['Gestern kam Lilly Jung vorbei.'];
    const result = joinNames(lines, [person(lines, 'Lilly')]);
    expect(texts(lines, result)).toEqual(['Lilly', 'Jung']);
  });

  it('adds a word surname that follows on the next line', () => {
    const lines = ['Gestern kam Lilly', 'Jung vorbei.'];
    const result = joinNames(lines, [person(lines, 'Lilly')]);
    expect(texts(lines, result)).toEqual(['Lilly', 'Jung']);
    expect(result[1]).toMatchObject({ line: 2, offset: 0, length: 4, category: 'person' });
  });

  it('does not add a capitalized word that is not a word surname', () => {
    const lines = ['Gestern kam Lilly Kuchen vorbei.'];
    expect(joinNames(lines, [person(lines, 'Lilly')])).toHaveLength(1);
  });

  it('joins two person spans across a misspelled particle', () => {
    const lines = ['Das ist Max vot Wettstein heute.'];
    const result = joinNames(lines, [person(lines, 'Max'), person(lines, 'Wettstein')]);
    expect(texts(lines, result)).toContain('vot');
  });

  it('joins two person spans across the particle von', () => {
    const lines = ['Das ist Max von Wettstein heute.'];
    const result = joinNames(lines, [person(lines, 'Max'), person(lines, 'Wettstein')]);
    expect(texts(lines, result)).toContain('von');
  });

  it('does not join across a common lowercase word', () => {
    const lines = ['Das ist Max und Wettstein heute.'];
    const result = joinNames(lines, [person(lines, 'Max'), person(lines, 'Wettstein')]);
    expect(result).toHaveLength(2);
  });

  it('adds a short capitalized token right before a person span', () => {
    const lines = ['Mein Bn Wilhelm ist nett.'];
    const result = joinNames(lines, [person(lines, 'Wilhelm')]);
    expect(texts(lines, result)).toContain('Bn');
  });

  it('does not add a short common word before a person span', () => {
    const lines = ['Ich Wilhelm bin da.'];
    expect(joinNames(lines, [person(lines, 'Wilhelm')])).toHaveLength(1);
  });

  it('ignores non-person spans and returns the input otherwise unchanged', () => {
    const lines = ['Lilly Jung wohnt hier.'];
    const place: PrivacySpan = { ...person(lines, 'Lilly'), category: 'place' };
    expect(joinNames(lines, [place])).toEqual([place]);
    expect(joinNames(lines, [])).toEqual([]);
  });
});

describe('withoutNounUses', () => {
  it('drops a common word after a determiner', () => {
    const lines = ['Da kam der Wolf aus dem Wald.'];
    expect(withoutNounUses(lines, [person(lines, 'Wolf')])).toEqual([]);
  });

  it('drops a common word after a determiner and adjectives', () => {
    const lines = ['Es war ein schlauer Fuchs.'];
    expect(withoutNounUses(lines, [person(lines, 'Fuchs')])).toEqual([]);
    const two = ['Es war ein kleiner kluger Fuchs.'];
    expect(withoutNounUses(two, [person(two, 'Fuchs')])).toEqual([]);
  });

  it('keeps a word surname after a title', () => {
    const lines = ['Da kam Herr Wolf aus dem Haus.'];
    const spans = [person(lines, 'Wolf')];
    expect(withoutNounUses(lines, spans)).toEqual(spans);
  });

  it('keeps a word surname after a determiner and a role followed by Herr', () => {
    const lines = ['Da kam der Förster Herr Wolf aus dem Haus.'];
    const spans = [person(lines, 'Wolf')];
    expect(withoutNounUses(lines, spans)).toEqual(spans);
  });

  it('keeps a lowercase name introduced by a naming phrase', () => {
    const lines = ['Der Junge, der heißt mark, kam.'];
    const spans = [person(lines, 'mark')];
    expect(withoutNounUses(lines, spans)).toEqual(spans);
  });

  it('keeps names that are not common words even after a determiner', () => {
    const lines = ['Da kam der Zorbek.'];
    const spans = [person(lines, 'Zorbek')];
    expect(withoutNounUses(lines, spans)).toEqual(spans);
  });

  it('keeps spans of other categories', () => {
    const lines = ['Da kam der Wolf.'];
    const place: PrivacySpan = { ...person(lines, 'Wolf'), category: 'place' };
    expect(withoutNounUses(lines, [place])).toEqual([place]);
  });
});
