import { describe, expect, it } from 'vitest';
import { detectPatterns, findPatternSpans } from './patterns.ts';

function found(lines: readonly string[]) {
  return findPatternSpans(lines).map((span) => [
    (lines[span.line - 1] ?? '').slice(span.offset, span.offset + span.length),
    span.category,
  ]);
}

describe('findPatternSpans', () => {
  it.each([
    ['Ich wohne in der Lindenstraße 12 und', 'Lindenstraße 12'],
    ['Ich wohne in der Lindenstraße 12a und', 'Lindenstraße 12a'],
    ['Wir gehen die Bahnhofstr. 5 entlang', 'Bahnhofstr. 5'],
    ['Er wohnt am Rosenweg.', 'Rosenweg'],
    ['Die Lindenallee ist lang.', 'Lindenallee'],
  ])('finds the street in %j', (line, expected) => {
    expect(found([line])).toEqual([[expected, 'place']]);
  });

  it.each([
    ['Am 03.04.2024 war es kalt.', '03.04.2024'],
    ['Am 3.4.24 war es kalt.', '3.4.24'],
    ['Am 3. 4. 2024 war es kalt.', '3. 4. 2024'],
    ['Wir fuhren am 12. Mai los.', '12. Mai'],
    ['Wir fuhren am 12. Mai 2023 los.', '12. Mai 2023'],
    ['Am 1 März kam er.', '1 März'],
    ['Am 5. Dez. kam er.', '5. Dez.'],
  ])('finds the date in %j', (line, expected) => {
    expect(found([line])).toEqual([[expected, 'date']]);
  });

  it.each([
    ['Am 32.01.2024 war es kalt.'],
    ['Am 15.13.2024 war es kalt.'],
    ['Am 00.05.2024 war es kalt.'],
    ['Am 12. Maiglöckchen blühen.'],
  ])('does not match an invalid date in %j', (line) => {
    expect(found([line]).filter(([, category]) => category === 'date')).toEqual([]);
  });

  it.each([
    ['Ich gehe in die Goethe-Schule.', 'Goethe-Schule'],
    ['Ich gehe aufs Gymnasium am Stadtpark heute.', 'Gymnasium am Stadtpark'],
    ['Die Grundschule Lindenhof ist klein.', 'Grundschule Lindenhof'],
    ['Er spielt beim TSV Altenau 1920.', 'TSV Altenau 1920'],
    ['Er spielt beim FC Rotenburg.', 'FC Rotenburg'],
    ['Die Kirchengemeinde St. Martin lädt ein.', 'Kirchengemeinde St. Martin'],
    ['Die Pfarrei Sankt Josef lädt ein.', 'Pfarrei Sankt Josef'],
    ['Wir waren in der Kita Sonnenschein.', 'Kita Sonnenschein'],
  ])('finds the institution in %j', (line, expected) => {
    expect(found([line])).toEqual([[expected, 'institution']]);
  });

  it('does not treat a generic school word as an institution', () => {
    expect(found(['Die Schule ist aus.'])).toEqual([]);
  });

  it.each([
    ['Ruf mich an: 0151 2345 6789 bitte', '0151 2345 6789'],
    ['Meine Nummer ist 040-1234567.', '040-1234567'],
    ['Die Matrikel 1234567 gehört dazu.', '1234567'],
  ])('finds digit runs in %j', (line, expected) => {
    expect(found([line])).toEqual([[expected, 'number']]);
  });

  it('ignores short numbers', () => {
    expect(found(['Ich bin 12 Jahre alt und habe 3 Brüder und 1234 Euro.'])).toEqual([]);
  });

  it.each([
    ['Das Auto HH-AB 1234 stand dort.', 'HH-AB 1234'],
    ['Das Auto M-XY 12 stand dort.', 'M-XY 12'],
    ['Das Auto B AB 123E stand dort.', 'B AB 123E'],
  ])('finds car plates in %j', (line, expected) => {
    expect(found([line])).toEqual([[expected, 'number']]);
  });

  it('reports several matches with line and offset', () => {
    const spans = findPatternSpans(['Nichts hier.', 'Am 03.04.2024 in der Lindenstraße 12.']);
    expect(spans.map((span) => [span.line, span.offset, span.length, span.source])).toEqual([
      [2, 3, 10, 'rule'],
      [2, 21, 15, 'rule'],
    ]);
  });

  it('returns nothing for plain text and empty input', () => {
    expect(found(['Der Hund läuft über die Wiese.'])).toEqual([]);
    expect(found([])).toEqual([]);
  });
});

describe('detectPatterns', () => {
  const context = { workName: 'x', language: 'de' };

  it('returns the pattern spans', async () => {
    const spans = await detectPatterns(['Am 03.04.2024.'], context, new AbortController().signal);
    expect(spans).toHaveLength(1);
  });

  it('rejects when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(detectPatterns(['x'], context, controller.signal)).rejects.toThrow(/abort/i);
  });
});
