import { describe, expect, it } from 'vitest';
import { detectRules, findRuleSpans } from './rules.ts';
import type { PrivacySpan } from './types.ts';

function found(lines: readonly string[], spans: readonly PrivacySpan[] = findRuleSpans(lines)) {
  return spans.map((span) => [
    (lines[span.line - 1] ?? '').slice(span.offset, span.offset + span.length),
    span.category,
  ]);
}

describe('findRuleSpans', () => {
  it.each([
    ['Schreib mir an mia.schulz@web.de, bitte.', 'mia.schulz@web.de', 'contact'],
    ['Meine Adresse: mia.schulz (at) web.de', 'mia.schulz (at) web.de', 'contact'],
    ['Mail: mia_s[at]gmx(punkt)de', 'mia_s[at]gmx(punkt)de', 'contact'],
    ['Mail: mia @ gmx.net', 'mia @ gmx.net', 'contact'],
    ['Ruf an: 0171 2345678 oder schreib.', '0171 2345678', 'contact'],
    ['Telefon (0561) 12 34 56', '(0561) 12 34 56', 'contact'],
    ['erreichbar unter +49 171 2345678.', '+49 171 2345678', 'contact'],
    ['erreichbar unter 0049 30/123456-7.', '0049 30/123456-7', 'contact'],
    ['Handy: 171 234 5678', '171 234 5678', 'contact'],
    ['Folg mir auf @mia_schulz08!', '@mia_schulz08', 'contact'],
    ['Mein Blog ist https://mia-schreibt.de/ferien.', 'https://mia-schreibt.de/ferien', 'contact'],
    ['Schau auf www.tsv-muehlheim.de nach', 'www.tsv-muehlheim.de', 'contact'],
    ['Mein Kanal: youtube.com/miaschulz', 'youtube.com/miaschulz', 'contact'],
    ['IBAN DE89 3704 0044 0532 0130 00', 'DE89 3704 0044 0532 0130 00', 'number'],
    ['iban: de89370400440532013000', 'de89370400440532013000', 'number'],
    ['meine Kontonummer ist 1234567890', '1234567890', 'number'],
    ['Kto.-Nr. 12 345 678', '12 345 678', 'number'],
    ['Schülerausweisnummer: S-2024-0815', 'S-2024-0815', 'number'],
    ['die Kundennummer 4711-0815 angeben', '4711-0815', 'number'],
    ['Mitglieds-Nr. 00123', '00123', 'number'],
    ['Das Kennzeichen war KS-AB 123.', 'KS-AB 123', 'number'],
    ['Nummer 12345 ist meine', '12345', 'number'],
    ['Wir wohnen in 34127 Kassel.', '34127 Kassel', 'place'],
    ['D-60311 Frankfurt am Main', 'D-60311 Frankfurt am Main', 'place'],
    ['in 3 4 1 2 7 Kassel', '3 4 1 2 7 Kassel', 'place'],
    ['Ich wohne Lindenstraße 12.', 'Lindenstraße 12', 'place'],
    ['Hauptstr. 5a, zweiter Stock', 'Hauptstr. 5a', 'place'],
    ['Goethe-Allee 7 ist schön', 'Goethe-Allee 7', 'place'],
    ['Konrad-Adenauer-Straße 1-3', 'Konrad-Adenauer-Straße 1-3', 'place'],
    ['Wir wohnen Am Lindenhof 3.', 'Am Lindenhof 3', 'place'],
    ['Berliner Straße 15 b', 'Berliner Straße 15 b', 'place'],
    ['Mühlheim, den 14.08.2025', '14.08.2025', 'date'],
    ['am 1.3.10 war das', '1.3.10', 'date'],
    ['Am 14. August 2025 war der Unfall.', '14. August 2025', 'date'],
    ['Am 3 Okt. 2024 ging es los.', '3 Okt. 2024', 'date'],
    ['Datum: 2025-08-14', '2025-08-14', 'date'],
    ['Ich bin am 12.03. geboren.', '12.03.', 'date'],
    ['Mein Geburtstag ist am 12. März.', '12. März', 'date'],
    ['geboren im März 2012', 'März 2012', 'date'],
    ['Kassel, den 14.08.', '14.08.', 'date'],
  ])('finds %j', (line, text, category) => {
    expect(found([line])).toEqual([[text, category]]);
  });

  it.each([
    'Im Jahr 1989 fiel die Mauer.',
    'Am 12. März fuhren wir los.',
    'Die Ferien dauern vom 14.08. bis zum 30.08.',
    'Im März 2024 waren wir am Meer.',
    'Ich habe 12345 Euro gespart und 25000 Punkte.',
    'Wir haben 3,5 Kilo und 0,25 Liter.',
    'Im Kapitel 3 und Am Ende 2 Seiten weiter.',
    'Im Jahr 2010 und In der Klasse 7 war alles anders.',
    'Er ging die Straße entlang und den Weg hinauf.',
    'Die Lösung ist 1.2.3 oder 4/5.',
    'Sie hat 2 Brüder und 10 Freunde, z.B. Tom.',
    'Mia hat 5 Hunde und wohnt in Kassel.',
    'Seite 12 Aufgabe 3 b',
    'Um 08:15 Uhr fing die Schule an.',
    'Er schrieb 1999 seinen ersten Roman.',
    'Der Weltrekord liegt bei 9,58 Sekunden.',
    'Wir trafen uns @ Hause.',
  ])('ignores %j', (line) => {
    expect(found([line])).toEqual([]);
  });

  it('splits an identifier across a line break into one span per line', () => {
    const lines = ['Ich wohne in der Linden-', 'straße 12 in 34127', 'Kassel.'];
    expect(found(lines)).toEqual([
      ['Linden-', 'place'],
      ['straße 12', 'place'],
      ['34127', 'place'],
      ['Kassel', 'place'],
    ]);
    expect(findRuleSpans(lines).map((span) => span.line)).toEqual([1, 2, 2, 3]);
  });

  it('accepts a birth keyword on the previous line', () => {
    expect(found(['Ich bin geboren', 'am 3.5. in Kassel'])).toEqual([['3.5.', 'date']]);
  });

  it('marks every span as an identifier from the rule source', () => {
    const [span] = findRuleSpans(['mia@web.de']);
    expect(span).toEqual({
      kind: 'identifier',
      category: 'contact',
      source: 'rule',
      line: 1,
      offset: 0,
      length: 10,
    });
  });

  it('merges overlapping matches into one span', () => {
    expect(found(['Tel. 0171 2345678'])).toEqual([['0171 2345678', 'contact']]);
  });

  it('works as a detector and honours the signal', async () => {
    const context = { workName: 'x', language: 'de' };
    await expect(
      detectRules(['mia@web.de'], context, new AbortController().signal),
    ).resolves.toHaveLength(1);
    const aborted = new AbortController();
    aborted.abort();
    await expect(detectRules(['mia@web.de'], context, aborted.signal)).rejects.toThrow('aborted');
  });
});
