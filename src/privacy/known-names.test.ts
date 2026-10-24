import { describe, expect, it } from 'vitest';
import { findKeptNames, withoutKept } from './known-names.ts';
import type { DetectorContext, IdentifierCategory, IdentifierSpan, PrivacySpan } from './types.ts';

const context: DetectorContext = { workName: 'Becker Tom 6a.pdf', language: 'de' };

function kept(lines: readonly string[], ctx: DetectorContext = context) {
  return findKeptNames(lines, ctx).map((entry) =>
    (lines[entry.line - 1] ?? '').slice(entry.offset, entry.offset + entry.length),
  );
}

function span(
  lines: readonly string[],
  text: string,
  category: IdentifierCategory = 'person',
): IdentifierSpan {
  const line = lines.findIndex((entry) => entry.includes(text));
  return {
    kind: 'identifier',
    category,
    source: 'rule',
    line: line + 1,
    offset: (lines[line] ?? '').indexOf(text),
    length: text.length,
  };
}

function texts(lines: readonly string[], spans: readonly PrivacySpan[]) {
  return spans.map((entry) =>
    (lines[entry.line - 1] ?? '').slice(entry.offset, entry.offset + entry.length).trim(),
  );
}

describe('findKeptNames', () => {
  it('keeps figures and author of a work named in the task', () => {
    const lines = ['Maik fährt mit Tschick, und Klingenberg staunt.'];
    expect(kept(lines, { ...context, task: 'Analysiere den Roman Tschick.' })).toEqual([
      'Maik',
      'Tschick',
      'Klingenberg',
    ]);
  });

  it('activates a work through the work name', () => {
    const lines = ['Maik ist der Erzähler.'];
    expect(kept(lines, { ...context, workName: 'Tschick Analyse.pdf' })).toEqual(['Maik']);
  });

  it('activates a work through its title in the text', () => {
    const lines = ['Im Buch Tschick erzählt Maik von der Reise.'];
    expect(kept(lines)).toEqual(['Tschick', 'Maik']);
  });

  it('does not keep a figure name when the work is never mentioned', () => {
    expect(kept(['Gestern war ich mit Maik im Schwimmbad.'])).toEqual([]);
  });

  it('activates a strict title only when it is quoted in the text', () => {
    const lines = ['In „Die Welle“ führt Ben Ross das Experiment an. Laurie widerspricht.'];
    expect(kept(lines)).toEqual(['Die Welle', 'Ben Ross', 'Laurie']);
  });

  it('does not activate a strict title that is not quoted', () => {
    const lines = ['Am Strand sah ich die Welle und Laurie lachte.'];
    expect(kept(lines)).toEqual([]);
  });

  it('does not keep a name directly after a private relation even when the work is active', () => {
    const lines = ['Woyzeck liebt Marie. Meine Schwester Marie mag das Stück nicht.'];
    expect(kept(lines, { ...context, task: 'Woyzeck' })).toEqual(['Woyzeck', 'Marie']);
  });

  it('does not keep a name after a private relation with an adjective in between', () => {
    const lines = ['Mein bester Banknachbar Tim liest Tschick.'];
    expect(kept(lines)).toEqual(['Tschick']);
  });

  it('does not keep names inside hyphen compounds', () => {
    expect(kept(['Ich gehe aufs Goethe-Gymnasium.'])).toEqual([]);
    expect(kept(['Ich gehe in die Erich-Kästner-Schule.'])).toEqual([]);
  });

  it('keeps a mononym standing alone', () => {
    expect(kept(['Goethe schrieb viele Gedichte.'])).toEqual(['Goethe']);
  });

  it('keeps the full name of a public figure', () => {
    expect(kept(['Angela Merkel war Kanzlerin.'])).toEqual(['Angela Merkel']);
  });

  it('keeps the surname of a public figure that appeared in full before', () => {
    const lines = ['Manuel Neuer hielt den Ball. Später lobte jeder Neuer.'];
    expect(kept(lines)).toEqual(['Manuel Neuer', 'Neuer']);
  });

  it('keeps initials in front of a kept name', () => {
    expect(kept(['Das Buch ist von J. K. Rowling.'])).toEqual(['J. K. Rowling']);
  });

  it('keeps particles between kept tokens', () => {
    const lines = ['Mathilde von Zahnd leitet die Anstalt.'];
    expect(kept(lines, { ...context, task: 'Die Physiker' })).toEqual(['Mathilde von Zahnd']);
  });

  it('keeps title occurrences of an active work', () => {
    const lines = ['Wir lesen Tschick im Unterricht.'];
    expect(kept(lines, { ...context, task: 'Tschick' })).toEqual(['Tschick']);
  });

  it('reports spans across lines with one-based line numbers', () => {
    const lines = ['Erste Zeile.', 'Dann kam Tschick.'];
    expect(findKeptNames(lines, { ...context, task: 'Tschick' })).toEqual([
      { kind: 'identifier', category: 'person', source: 'rule', line: 2, offset: 9, length: 7 },
    ]);
  });
});

describe('withoutKept', () => {
  it('returns the spans unchanged when nothing is kept', () => {
    const lines = ['Lena Becker kam.'];
    const spans = [span(lines, 'Lena Becker')];
    expect(withoutKept(spans, [], lines)).toEqual(spans);
  });

  it('removes a kept part from a person span and keeps the rest', () => {
    const lines = ['Maik Becker kam.'];
    const result = withoutKept([span(lines, 'Maik Becker')], [span(lines, 'Maik')], lines);
    expect(texts(lines, result)).toEqual(['Becker']);
  });

  it('splits a span when the kept part is in the middle', () => {
    const lines = ['Lena Maik Becker kam.'];
    const result = withoutKept([span(lines, 'Lena Maik Becker')], [span(lines, 'Maik')], lines);
    expect(texts(lines, result)).toEqual(['Lena', 'Becker']);
  });

  it('drops a span that is fully kept', () => {
    const lines = ['Maik kam.'];
    expect(withoutKept([span(lines, 'Maik')], [span(lines, 'Maik')], lines)).toEqual([]);
  });

  it('applies to place and institution spans', () => {
    const lines = ['Goethe Gymnasium und Goethe Stadt'];
    const spans = [
      span(lines, 'Goethe Gymnasium', 'institution'),
      span(lines, 'Goethe Stadt', 'place'),
    ];
    const keptSpans = [
      { ...span(lines, 'Goethe'), offset: 0, length: 6 },
      { ...span(lines, 'Goethe'), offset: 21, length: 6 },
    ];
    expect(texts(lines, withoutKept(spans, keptSpans, lines))).toEqual(['Gymnasium', 'Stadt']);
  });

  it('leaves other categories and sensitive spans untouched', () => {
    const lines = ['Maik am 03.04.2024'];
    const date = span(lines, '03.04.2024', 'date');
    const sensitive: PrivacySpan = {
      kind: 'sensitive',
      category: 'health',
      source: 'model',
      line: 1,
      offset: 0,
      length: 4,
    };
    const contact = { ...span(lines, 'Maik', 'contact') };
    const result = withoutKept([date, sensitive, contact], [span(lines, 'Maik')], lines);
    expect(result).toEqual([date, sensitive, contact]);
  });

  it('ignores kept spans on other lines', () => {
    const lines = ['Maik kam.', 'Maik ging.'];
    const spans = [span(lines, 'Maik')];
    const result = withoutKept(spans, [{ ...span(lines, 'Maik'), line: 2 }], lines);
    expect(result).toEqual(spans);
  });
});
