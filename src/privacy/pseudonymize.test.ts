import { describe, expect, it } from 'vitest';
import { pseudonymize, pseudonymizeWork } from './pseudonymize.ts';
import type { IdentifierCategory, PrivacySource, PrivacySpan } from './types.ts';

function span(
  lines: readonly string[],
  line: number,
  text: string,
  category: IdentifierCategory,
  source: PrivacySource = 'rule',
  occurrence = 0,
): PrivacySpan {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = (lines[line - 1] ?? '').indexOf(text, offset + 1);
  }
  if (offset < 0) throw new Error(`${text} fehlt in Zeile ${line}`);
  return { kind: 'identifier', category, source, line, offset, length: text.length };
}

describe('pseudonymize', () => {
  it('replaces identifiers with numbered placeholders per category', () => {
    const lines = ['Mia wohnt in 34127 Kassel.', 'Schreib an mia@web.de oder Ben.'];
    const result = pseudonymize(lines, [
      span(lines, 1, 'Mia', 'person', 'name-list'),
      span(lines, 1, '34127 Kassel', 'place'),
      span(lines, 2, 'mia@web.de', 'contact'),
      span(lines, 2, 'Ben', 'person', 'model'),
    ]);
    expect(result.lines).toEqual([
      '[Person 1] wohnt in [Ort 1].',
      'Schreib an [Kontakt 1] oder [Person 2].',
    ]);
    expect(result.replacements[1]).toEqual({
      line: 1,
      offset: 13,
      length: 12,
      sentOffset: 20,
      placeholder: '[Ort 1]',
      original: '34127 Kassel',
      category: 'place',
    });
    expect([...result.originals]).toEqual([
      ['[Person 1]', 'Mia'],
      ['[Ort 1]', '34127 Kassel'],
      ['[Kontakt 1]', 'mia@web.de'],
      ['[Person 2]', 'Ben'],
    ]);
  });

  it('gives the same normalized form the same placeholder across pages', () => {
    const first = ['Mia und  Ben'];
    const second = ['MIA kam, ben  nicht.', 'Mia Schulz'];
    const work = pseudonymizeWork([
      {
        lines: first,
        spans: [span(first, 1, 'Mia', 'person'), span(first, 1, 'Ben', 'person')],
      },
      {
        lines: second,
        spans: [
          span(second, 1, 'MIA', 'person'),
          span(second, 1, 'ben', 'person'),
          span(second, 2, 'Mia Schulz', 'person'),
        ],
      },
    ]);
    expect(work.pages.map((page) => page.lines)).toEqual([
      ['[Person 1] und  [Person 2]'],
      ['[Person 1] kam, [Person 2]  nicht.', '[Person 3]'],
    ]);
  });

  it('skips placeholder numbers that the text already contains', () => {
    const lines = ['[Person 1] heißt Mia'];
    expect(pseudonymize(lines, [span(lines, 1, 'Mia', 'person')]).lines).toEqual([
      '[Person 1] heißt [Person 2]',
    ]);
  });

  it('keeps the same text in different categories apart', () => {
    const lines = ['Linden ist Linden'];
    const result = pseudonymize(lines, [
      span(lines, 1, 'Linden', 'person'),
      span(lines, 1, 'Linden', 'place', 'rule', 1),
    ]);
    expect(result.lines).toEqual(['[Person 1] ist [Ort 1]']);
  });

  it('merges overlapping detector spans into the larger one', () => {
    const lines = ['Ich wohne Lindenstraße 12 hier.'];
    const result = pseudonymize(lines, [
      span(lines, 1, 'Lindenstraße', 'person', 'model'),
      span(lines, 1, 'straße 12', 'place', 'rule'),
    ]);
    expect(result.lines).toEqual(['Ich wohne [Person 1] hier.']);
    expect(result.replacements[0]?.original).toBe('Lindenstraße 12');
  });

  it('lets the larger span decide the category of a merged span', () => {
    const lines = ['Ich wohne Lindenstraße 12 hier.'];
    const result = pseudonymize(lines, [
      span(lines, 1, 'Linden', 'person', 'name-list'),
      span(lines, 1, 'Lindenstraße 12', 'place', 'rule'),
    ]);
    expect(result.lines).toEqual(['Ich wohne [Ort 1] hier.']);
  });

  it('lets teacher spans win over overlapping detector spans', () => {
    const lines = ['Gruß von Mia Schulz aus Kassel'];
    const result = pseudonymize(lines, [
      span(lines, 1, 'Mia Schulz', 'person', 'name-list'),
      span(lines, 1, 'Schulz aus', 'place', 'model'),
      span(lines, 1, 'Mia', 'institution', 'teacher'),
      span(lines, 1, 'Kassel', 'place', 'model'),
    ]);
    expect(result.lines).toEqual(['Gruß von [Einrichtung 1] [Ort 1] [Ort 2]']);
  });

  it('leaves sensitive spans unchanged', () => {
    const lines = ['Mia hat ADHS und ist katholisch.'];
    const result = pseudonymize(lines, [
      span(lines, 1, 'Mia', 'person'),
      { kind: 'sensitive', category: 'health', source: 'model', line: 1, offset: 8, length: 4 },
      {
        kind: 'sensitive',
        category: 'religion',
        source: 'teacher',
        line: 1,
        offset: 21,
        length: 10,
      },
    ]);
    expect(result.lines).toEqual(['[Person 1] hat ADHS und ist katholisch.']);
  });

  it('never changes the number of lines and ignores spans outside the text', () => {
    const lines = ['', 'Mia', ' '];
    const result = pseudonymize(lines, [
      { kind: 'identifier', category: 'person', source: 'rule', line: 0, offset: 0, length: 3 },
      { kind: 'identifier', category: 'person', source: 'rule', line: 4, offset: 0, length: 3 },
      { kind: 'identifier', category: 'person', source: 'rule', line: 1, offset: 0, length: 3 },
      { kind: 'identifier', category: 'person', source: 'rule', line: 3, offset: 0, length: 9 },
      {
        kind: 'identifier',
        category: 'person',
        source: 'rule',
        line: 2,
        offset: Number.NaN,
        length: 3,
      },
    ]);
    expect(result.lines).toEqual(['', 'Mia', ' ']);
    expect(result.replacements).toEqual([]);
  });

  it('clamps spans to the line and trims surrounding whitespace', () => {
    const lines = ['Gruß, Mia '];
    const result = pseudonymize(lines, [
      { kind: 'identifier', category: 'person', source: 'teacher', line: 1, offset: 5, length: 40 },
    ]);
    expect(result.lines).toEqual(['Gruß, [Person 1] ']);
  });
});
