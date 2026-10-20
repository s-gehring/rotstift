import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH, SPANISCH } from '../annotations/profile.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { transcriptSchema } from '../annotations/transcript.ts';
import type { Mark } from '../annotations/transcript.ts';
import { deriveMarks, deriveMarksDetailed } from './derive.ts';
import type { DeriveOptions } from './derive.ts';

function derive(lines: string[], corrected: string, options: Partial<DeriveOptions> = {}) {
  return deriveMarks(lines, corrected, { profile: DEUTSCH, ...options });
}

function marksOf(lines: string[], corrected: string, options: Partial<DeriveOptions> = {}) {
  return derive(lines, corrected, options).map((line) => line.marks);
}

function onlyProfile(...allowedTypes: string[]): CorrectionProfile {
  return { ...DEUTSCH, id: 'eng', name: 'Eng', allowedTypes };
}

const error = (type: string, original: string, correction: string, offset: number): Mark => ({
  kind: 'error',
  type,
  original,
  correction,
  offset,
});

const omission = (type: string, correction: string, offset: number): Mark => ({
  kind: 'omission',
  type,
  original: '',
  correction,
  offset,
});

describe('deriveMarks types', () => {
  it('marks a misspelled word as R', () => {
    expect(marksOf(['Ich habe Muscheln gesamelt.'], 'Ich habe Muscheln gesammelt.')).toEqual([
      [error('R', 'gesamelt.'.slice(0, 8), 'gesammelt', 18)],
    ]);
  });

  it('marks a case change as R', () => {
    expect(marksOf(['Wir gehen zum essen.'], 'Wir gehen zum Essen.')).toEqual([
      [error('R', 'essen', 'Essen', 14)],
    ]);
  });

  it('marks a joined or split word as R over the whole span', () => {
    expect(marksOf(['Wir gehen zu sammen nach Hause.'], 'Wir gehen zusammen nach Hause.')).toEqual([
      [error('R', 'zu sammen', 'zusammen', 10)],
    ]);
    expect(marksOf(['Statt dessen blieb er.'], 'Stattdessen blieb er.')).toEqual([
      [error('R', 'Statt dessen', 'Stattdessen', 0)],
    ]);
  });

  it('marks a missing comma as a Z omission behind the previous word', () => {
    expect(marksOf(['Ich glaube dass er kommt.'], 'Ich glaube, dass er kommt.')).toEqual([
      [omission('Z', ',', 10)],
    ]);
  });

  it('marks a superfluous or exchanged punctuation mark as Z', () => {
    expect(marksOf(['Er kam, und ging.'], 'Er kam und ging.')).toEqual([[error('Z', ',', '', 6)]]);
    expect(marksOf(['Ich esse. Du trinkst.'], 'Ich esse; Du trinkst.')).toEqual([
      [error('Z', '.', ';', 8)],
    ]);
  });

  it('marks an inflection change with the same stem as G', () => {
    expect(marksOf(['Viele Eltern möchte das.'], 'Viele Eltern möchten das.')).toEqual([
      [error('G', 'möchte', 'möchten', 13)],
    ]);
    expect(marksOf(['Sie gibt ihn ein Buch.'], 'Sie gibt ihm ein Buch.')).toEqual([
      [error('G', 'ihn', 'ihm', 9)],
    ]);
  });

  it('marks a different word as A', () => {
    expect(marksOf(['Er rannte voll schnell.'], 'Er rannte sehr schnell.')).toEqual([
      [error('A', 'voll', 'sehr', 10)],
    ]);
  });

  it('marks a missing word as an A omission before the next word', () => {
    expect(marksOf(['Ich habe Hund.'], 'Ich habe einen Hund.')).toEqual([
      [omission('A', 'einen', 9)],
    ]);
  });

  it('marks a reordering as Sb over the moved words', () => {
    expect(marksOf(['Gestern ich ging nach Hause.'], 'Gestern ging ich nach Hause.')).toEqual([
      [error('Sb', 'ich ging', 'ging ich', 8)],
    ]);
  });

  it('keeps independent errors separate', () => {
    expect(
      marksOf(['Ich hoffe das ich vieleicht komme.'], 'Ich hoffe, dass ich vielleicht komme.'),
    ).toEqual([
      [
        omission('Z', ',', 9),
        error('R', 'das', 'dass', 10),
        error('R', 'vieleicht', 'vielleicht', 18),
      ],
    ]);
  });

  it('creates no marks when nothing changed', () => {
    expect(marksOf(['Alles ist richtig.'], 'Alles ist richtig.')).toEqual([[]]);
  });
});

describe('deriveMarks grammar versus spelling', () => {
  it.each([
    ['Viele Eltern möchte das.', 'Viele Eltern möchten das.', ['möchte', 'möchten']],
    ['Sie gibt ihn ein Buch.', 'Sie gibt ihm ein Buch.', ['ihn', 'ihm']],
    ['Dann spricht sie ihm nicht an.', 'Dann spricht sie ihn nicht an.', ['ihm', 'ihn']],
    ['Wegen dem Regen sind wir da.', 'Wegen des Regens sind wir da.', ['dem Regen', 'des Regens']],
    ['Er sagt, er hätte es gesehen.', 'Er sagt, er habe es gesehen.', ['hätte', 'habe']],
    ['Er sagt, alles ist in Ordnung.', 'Er sagt, alles sei in Ordnung.', ['ist', 'sei']],
  ])('marks %j as one G mark', (line, corrected, [original, correction]) => {
    const marks = marksOf([line], corrected)[0] ?? [];
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ type: 'G', original, correction });
  });

  it('keeps R for letter errors in the stem', () => {
    expect(marksOf(['Der Hunt bellt.'], 'Der Hund bellt.')).toEqual([
      [error('R', 'Hunt', 'Hund', 4)],
    ]);
    expect(marksOf(['Sie hat gefreud.'], 'Sie hat gefreut.')).toEqual([
      [error('R', 'gefreud.'.slice(0, 7), 'gefreut', 8)],
    ]);
  });

  it('does not merge neighbouring grammar and spelling changes', () => {
    const marks = marksOf(['Wegen dem Rägen.'], 'Wegen des Regens.')[0] ?? [];
    expect(marks.map((mark) => mark.type)).toEqual(['G', 'R']);
  });
});

describe('deriveMarks structure', () => {
  it('keeps the original lines untouched and numbers every line', () => {
    const lines = ['Erste  Zeile mit  Abstand', '', 'Zweite zeile'];
    const result = derive(lines, 'Erste Zeile mit Abstand\n\nZweite Zeile');
    expect(result.map((line) => line.text)).toEqual(lines);
    expect(result.map((line) => line.number)).toEqual([1, 2, 3]);
    expect(result[2]?.marks).toEqual([error('R', 'zeile', 'Zeile', 7)]);
    expect(transcriptSchema.safeParse({ lines: result }).success).toBe(true);
  });

  it('ignores where the model breaks lines', () => {
    expect(
      marksOf(
        ['Wir sind früh losgefahren weil', 'Rutche war toll.'],
        'Wir sind früh\nlosgefahren, weil Rutsche war toll.',
      ),
    ).toEqual([[omission('Z', ',', 25)], [error('R', 'Rutche', 'Rutsche', 0)]]);
  });

  it('puts marks on the line they belong to', () => {
    expect(
      marksOf(['Ich habe', 'Schockolade gegessen.'], 'Ich habe\nSchokolade gegessen.'),
    ).toEqual([[], [error('R', 'Schockolade', 'Schokolade', 0)]]);
  });

  it('handles words hyphenated across line ends', () => {
    expect(marksOf(['Die Ru-', 'tche war toll.'], 'Die Rutsche war toll.')).toEqual([
      [],
      [error('R', 'tche', 'tsche', 0)],
    ]);
    expect(marksOf(['Die Rut-', 'sche war toll.'], 'Die Rutsche war toll.')).toEqual([[], []]);
    expect(marksOf(['Die Rut-', 'sche war toll.'], 'Die Rut-\nsche war toll.')).toEqual([[], []]);
    expect(marksOf(['Das Haus ist gro-', 'ß und alt.'], 'Das Haus ist groß und alt.')).toEqual([
      [],
      [],
    ]);
  });

  it('does not treat a hyphen before a capital as hyphenation', () => {
    expect(marksOf(['Die E-', 'Mail kam an.'], 'Die E-\nMail kam an.')).toEqual([[], []]);
  });

  it('attaches an omission after a hyphenated word to the end of its last part', () => {
    expect(
      marksOf(
        ['Wir bauen die Rut-', 'sche weil es', 'regnet.'],
        'Wir bauen die Rutsche, weil es regnet.',
      ),
    ).toEqual([[], [omission('Z', ',', 4)], []]);
  });

  it('puts an omitted opening mark before the next word, also across lines', () => {
    expect(
      marksOf(['Hola. Cómo te llamas?'], 'Hola. ¿Cómo te llamas?', { profile: SPANISCH }),
    ).toEqual([[omission('Z', '¿', 6)]]);
    expect(
      marksOf(['Fue un buen día.', 'Cómo te llamas?'], 'Fue un buen día. ¿Cómo te llamas?', {
        profile: SPANISCH,
      }),
    ).toEqual([[], [omission('Z', '¿', 0)]]);
  });

  it('drops marks that would overlap', () => {
    const lines = derive(['Der Hund bellt laut.'], 'Ein Tier jault laut.');
    expect(transcriptSchema.safeParse({ lines }).success).toBe(true);
  });
});

describe('deriveMarks profile restriction', () => {
  it('drops marks whose type the profile does not allow', () => {
    const profile = onlyProfile('R');
    expect(
      marksOf(['Ich hoffe das ich vieleicht komme.'], 'Ich hoffe, dass ich vielleicht komme.', {
        profile,
      }),
    ).toEqual([[error('R', 'das', 'dass', 10), error('R', 'vieleicht', 'vielleicht', 18)]]);
  });

  it('drops reorderings without Sb', () => {
    expect(
      marksOf(['Gestern ich ging nach Hause.'], 'Gestern ging ich nach Hause.', {
        profile: onlyProfile('R', 'Z'),
      }),
    ).toEqual([[]]);
  });

  it('uses the English codes for the English profile', () => {
    expect(
      marksOf(['I recieved your leter yesterday'], 'I received your letter yesterday.', {
        profile: ENGLISCH,
      }),
    ).toEqual([
      [
        error('sp', 'recieved', 'received', 2),
        error('sp', 'leter', 'letter', 16),
        omission('p', '.', 31),
      ],
    ]);
  });

  it('marks English inflection as gr', () => {
    expect(marksOf(['She like apples.'], 'She likes apples.', { profile: ENGLISCH })).toEqual([
      [error('gr', 'like', 'likes', 4)],
    ]);
  });
});

describe('deriveMarks quotation marks', () => {
  it('ignores typographic quotation marks the model substituted', () => {
    expect(marksOf(['Der "Niwa" ist ein Auto.'], 'Der „Niwa“ ist ein Auto.')).toEqual([[]]);
    expect(marksOf(['Er sagt: „Hallo“.'], 'Er sagt: "Hallo".')).toEqual([[]]);
  });

  it('still marks a real quote error next to it', () => {
    expect(marksOf(['Der "Niwa ist ein Auto.'], 'Der „Niwa“ ist ein Auto.')).toEqual([
      [omission('Z', '“', 9)],
    ]);
  });
});

describe('deriveMarks rewording', () => {
  const original = ['Der alte Mann geht in die Stadt und kauft ein Brot.'];
  const reworded = 'Ein älterer Herr ging in die Stadt und kaufte ein Brot.';

  it('collapses more than three consecutive changed words into one A mark', () => {
    expect(marksOf(original, reworded)).toEqual([
      [
        error('A', 'Der alte Mann geht', 'Ein älterer Herr ging', 0),
        error('G', 'kauft', 'kaufte', 36),
      ],
    ]);
  });

  it('counts the collapsed runs', () => {
    const derived = deriveMarksDetailed(original, reworded, { profile: DEUTSCH });
    expect(derived.collapsedRuns).toBe(1);
    expect(
      deriveMarksDetailed(original, original[0] ?? '', { profile: DEUTSCH }).collapsedRuns,
    ).toBe(0);
  });

  it('drops the collapsed rewording when A is not allowed', () => {
    expect(marksOf(original, reworded, { profile: onlyProfile('R', 'G') })).toEqual([
      [error('G', 'kauft', 'kaufte', 36)],
    ]);
  });

  it('makes the limit a parameter', () => {
    const marks = marksOf(original, reworded, { maxChangedRun: 4 })[0] ?? [];
    expect(marks.map((mark) => mark.original)).toEqual(['Der', 'alte', 'Mann', 'geht', 'kauft']);
    expect(marks.filter((mark) => mark.type === 'A')).toHaveLength(4);
    const strict = marksOf(['Er ist müde und hungrig.'], 'Sie war sehr müde.', {
      maxChangedRun: 1,
    });
    expect(strict[0]?.filter((mark) => mark.type === 'A').length).toBeLessThanOrEqual(1);
  });

  it('collapses a rewriting that matches single words by chance', () => {
    expect(
      marksOf(
        ['Ich habe gestern einen Hund gesehen der war groß und braun.'],
        'Gestern sah ich einen großen braunen Hund.',
      ),
    ).toEqual([
      [
        error(
          'A',
          'Ich habe gestern einen Hund gesehen der war groß und braun',
          'Gestern sah ich einen großen braunen Hund',
          0,
        ),
      ],
    ]);
  });

  it('reports swapped neighbours as Sb instead of several A marks', () => {
    const marks = marksOf(
      ['Er sagte dass er müde sei und gehen wolle.'],
      'Er sagte, er sei müde und wolle gehen.',
    )[0];
    expect(marks?.filter((mark) => mark.type === 'Sb').map((mark) => mark.original)).toEqual([
      'müde sei',
      'gehen wolle',
    ]);
  });

  it('does not collapse errors that are merely close to each other', () => {
    const marks = marksOf(
      ['Ich hoffe das wir vieleicht schon morgen gewinen.'],
      'Ich hoffe, dass wir vielleicht schon morgen gewinnen.',
    )[0];
    expect(marks?.map((mark) => mark.type)).toEqual(['Z', 'R', 'R', 'R']);
  });

  it('turns a long inserted passage into a single mark', () => {
    const marks = marksOf(
      ['Ich habe das Buch gelesen.'],
      'Ich habe das Buch gelesen und fand es sehr lang.',
    )[0];
    expect(marks).toHaveLength(1);
    expect(marks?.[0]?.type).toBe('A');
  });
});
