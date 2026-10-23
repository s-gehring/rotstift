import { describe, expect, it } from 'vitest';
import { propagateSpans } from './propagate.ts';
import type { PrivacySpan } from './types.ts';

function texts(lines: readonly string[], spans: readonly PrivacySpan[]) {
  return spans.map((span) => [
    span.line,
    (lines[span.line - 1] ?? '').slice(span.offset, span.offset + span.length),
    span.category,
    span.source,
  ]);
}

const at = (
  line: number,
  offset: number,
  length: number,
  category: Extract<PrivacySpan, { kind: 'identifier' }>['category'] = 'person',
  source: PrivacySpan['source'] = 'model',
): PrivacySpan => ({ kind: 'identifier', category, source, line, offset, length });

describe('propagateSpans', () => {
  it('replaces every other occurrence across all pages of the work', () => {
    const first = ['Lena kam.', 'Dann LENA und Lena.'];
    const second = ['Später kam Léna wieder.'];
    const [one, two] = propagateSpans([
      { lines: first, spans: [at(1, 0, 4)] },
      { lines: second, spans: [] },
    ]);
    expect(texts(first, one ?? [])).toEqual([
      [1, 'Lena', 'person', 'model'],
      [2, 'LENA', 'person', 'model'],
      [2, 'Lena', 'person', 'model'],
    ]);
    expect(texts(second, two ?? [])).toEqual([[1, 'Léna', 'person', 'model']]);
  });

  it('adds single name parts of a person, common words only where capitalized', () => {
    const lines = [
      'Gruß von Mia Schulz.',
      'Mia und Schulz und mia schulz.',
      'Frau Klein und Mia Klein, ein klein wenig.',
    ];
    const [spans] = propagateSpans([
      { lines, spans: [at(1, 9, 10, 'person', 'teacher'), at(3, 15, 9, 'person', 'name-list')] },
    ]);
    expect(texts(lines, spans ?? [])).toEqual([
      [1, 'Mia Schulz', 'person', 'teacher'],
      [3, 'Mia Klein', 'person', 'name-list'],
      [2, 'mia schulz', 'person', 'teacher'],
      [2, 'Schulz', 'person', 'teacher'],
      [3, 'Klein', 'person', 'name-list'],
      [2, 'Mia', 'person', 'teacher'],
    ]);
  });

  it('passes a name on with one typo from five letters and the same first letter', () => {
    const lines = ['Johanna kam.', 'Dann Johana, Johannas Rad, Kohanna und Jona.'];
    const [spans] = propagateSpans([{ lines, spans: [at(1, 0, 7)] }]);
    expect(texts(lines, spans ?? []).map(([line, text]) => [line, text])).toEqual([
      [1, 'Johanna'],
      [2, 'Johanna'],
      [2, 'Johana'],
    ]);
  });

  it('replaces a hyphenated place or name as a whole', () => {
    const lines = ['Wir wohnen in Münster-Hiltrup.', 'Anne-Sophie und Hiltrup.'];
    const [spans] = propagateSpans([{ lines, spans: [at(1, 22, 7, 'place'), at(2, 0, 4)] }]);
    expect(texts(lines, spans ?? []).map(([line, text]) => [line, text])).toEqual([
      [1, 'Münster-Hiltrup'],
      [2, 'Anne-Sophie'],
      [2, 'Hiltrup'],
    ]);
  });

  it('propagates names and places with a hyphen', () => {
    const lines = ['Anne-Sophie kam.', 'Dann kam anne-sophie aus der Käthe-Kollwitz-Schule.'];
    const [spans] = propagateSpans([
      { lines, spans: [at(1, 0, 11), at(2, 29, 21, 'institution', 'teacher')] },
    ]);
    expect(texts(lines, spans ?? [])).toEqual([
      [1, 'Anne-Sophie', 'person', 'model'],
      [2, 'Käthe-Kollwitz-Schule', 'institution', 'teacher'],
      [2, 'anne-sophie', 'person', 'model'],
    ]);
  });

  it('passes on the name parts of places but not generic words or other categories', () => {
    const lines = [
      'Wir wohnen in 34127 Kassel, ich gehe auf die Schule am Park.',
      'In Kassel und 34127 Kassel, Schule und Park, Tel. 0561 12345.',
    ];
    const [spans] = propagateSpans([
      {
        lines,
        spans: [
          at(1, 14, 12, 'place', 'rule'),
          at(1, 45, 14, 'institution', 'rule'),
          at(2, 50, 10, 'contact', 'rule'),
        ],
      },
    ]);
    expect(texts(lines, spans ?? [])).toEqual([
      [1, '34127 Kassel', 'place', 'rule'],
      [1, 'Schule am Park', 'institution', 'rule'],
      [2, '0561 12345', 'contact', 'rule'],
      [2, '34127 Kassel', 'place', 'rule'],
      [2, 'Kassel', 'place', 'rule'],
    ]);
  });

  it('leaves the genitive outside and skips parts of words', () => {
    const lines = ['Lena kam.', "Lenas Hund, Lena's Katze, Lenaufer, Helena, Lena-Marie."];
    const [spans] = propagateSpans([{ lines, spans: [at(1, 0, 4)] }]);
    expect(texts(lines, spans ?? []).map(([line, text]) => [line, text])).toEqual([
      [1, 'Lena'],
      [2, 'Lena'],
      [2, 'Lena'],
      [2, 'Lena'],
    ]);
    expect(spans?.slice(1).map((span) => span.offset)).toEqual([0, 12, 44]);
  });

  it('finds an occurrence split across a line break', () => {
    const lines = ['Lena kam.', 'Dann kam Le-', 'na.'];
    const [spans] = propagateSpans([{ lines, spans: [at(1, 0, 4)] }]);
    expect(texts(lines, spans ?? []).map(([line, text]) => [line, text])).toEqual([
      [1, 'Lena'],
      [2, 'Le-'],
      [3, 'na'],
    ]);
  });

  it('does not propagate the parts of a span broken across lines', () => {
    const lines = ['Gruß von Schu-', 'lz und Schu.'];
    const [spans] = propagateSpans([{ lines, spans: [at(1, 9, 5), at(2, 0, 2)] }]);
    expect(spans).toHaveLength(2);
  });

  it('does not propagate sensitive spans', () => {
    const lines = ['Mia hat ADHS.', 'Auch Ben hat ADHS.'];
    const sensitive: PrivacySpan = {
      kind: 'sensitive',
      category: 'health',
      source: 'model',
      line: 1,
      offset: 8,
      length: 4,
    };
    const [spans] = propagateSpans([{ lines, spans: [sensitive] }]);
    expect(spans).toEqual([sensitive]);
  });

  it('adds no duplicates and keeps existing spans', () => {
    const lines = ['Lena und Lena'];
    const existing = [at(1, 0, 4), at(1, 9, 4, 'person', 'teacher')];
    const [spans] = propagateSpans([{ lines, spans: existing }]);
    expect(spans).toEqual(existing);
  });
});
