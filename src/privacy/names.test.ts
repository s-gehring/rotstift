import { describe, expect, it } from 'vitest';
import { detectNames, findNameSpans, namesFromWorkName } from './names.ts';

function found(lines: readonly string[], names: readonly string[]) {
  return findNameSpans(lines, names).map((span) =>
    (lines[span.line - 1] ?? '').slice(span.offset, span.offset + span.length),
  );
}

describe('namesFromWorkName', () => {
  it.each([
    ['Mia Schulz 7b.pdf', ['Mia', 'Schulz']],
    ['schulz_mia_aufsatz', ['schulz', 'mia']],
    ['Aufsatz Lukas K', ['Lukas']],
    ['7b_Schulz.pdf', ['Schulz']],
    ['Mia S. Erörterung.jpg', ['Mia']],
    ['Aufsatz Ben K..pdf', ['Ben']],
    ['IMG_2041.jpg', []],
    ['Scan 2025-11-03 0815.pdf', []],
    ['klassenarbeit_3_seite1.pdf', []],
    ['MiaSchulz_Deutsch_KA2.pdf', ['Mia', 'Schulz']],
    ['Müller-Lüdenscheidt, Anna (Klasse 8c) Seite 2.png', ['Müller', 'Lüdenscheidt', 'Anna']],
    ['C:\\Scans\\Ayşe Yılmaz Brief.pdf', ['Ayşe', 'Yılmaz']],
    ["O'Brien Liam Inhaltsangabe", ['Brien', 'Liam']],
    ['Erörterung Mathe 12.03.2025 Jonas Jonas.pdf', ['Jonas']],
    ['Tagebuch_Nguyen_Thi_Lan_9a.heic', ['Nguyen', 'Thi', 'Lan']],
  ])('reads %j', (workName, names) => {
    expect(namesFromWorkName(workName)).toEqual(names);
  });
});

describe('findNameSpans', () => {
  it('finds names regardless of case', () => {
    expect(found(['ich und jonas gingen zu MIA.'], ['Jonas', 'Mia'])).toEqual(['jonas', 'MIA']);
  });

  it('leaves the genitive s and the apostrophe outside the span', () => {
    expect(found(["Mias Hund und Jonas' Katze"], ['Mia', 'Jonas'])).toEqual(['Mia', 'Jonas']);
    expect(found(['Lenas Fahrrad'], ['Lena'])).toEqual(['Lena']);
  });

  it('finds misread names within the allowed distance', () => {
    expect(found(['Shulz kam zu spät.'], ['Schulz'])).toEqual(['Shulz']);
    expect(found(['Lkuas kam.'], ['Lukas'])).toEqual(['Lkuas']);
    expect(found(['Johnanes und Johanes kamen.'], ['Johannes'])).toEqual(['Johnanes', 'Johanes']);
    expect(found(['Müler und Muller'], ['Müller'])).toEqual(['Müler', 'Muller']);
  });

  it('does not allow misreadings beyond the distance', () => {
    expect(found(['Mai und Mira kamen.'], ['Mia'])).toEqual([]);
    expect(found(['Schurz kam, Schmolz auch.'], ['Schulz'])).toEqual(['Schurz']);
    expect(found(['Jonathan kam.'], ['Johannes'])).toEqual([]);
  });

  it('only matches whole words', () => {
    expect(found(['In Miami kauft Benjamin Bennos Brot.'], ['Mia', 'Ben'])).toEqual([]);
  });

  it('merges first and last name into one span', () => {
    expect(found(['Ich bin Mia Schulz aus der 7b.'], ['Mia', 'Schulz'])).toEqual(['Mia Schulz']);
    expect(found(['Mia-Sophie kam.'], ['Mia', 'Sophie'])).toEqual(['Mia-Sophie']);
  });

  it('splits a name across a line break, also with a hyphen', () => {
    const lines = ['Gestern kam Ma-', 'rek und Mia', 'Schulz.'];
    const spans = findNameSpans(lines, ['Marek', 'Mia', 'Schulz']);
    expect(spans.map((span) => [span.line, span.offset, span.length])).toEqual([
      [1, 12, 3],
      [2, 0, 3],
      [2, 8, 3],
      [3, 0, 6],
    ]);
    expect(spans.every((span) => span.source === 'name-list' && span.category === 'person')).toBe(
      true,
    );
  });

  it('matches exact names even when they are ordinary words', () => {
    expect(found(['Der Wolf heulte, Frau Wolf lachte.'], ['Wolf'])).toEqual(['Wolf', 'Wolf']);
  });

  const COMMON_NAMES = [
    'Schulz',
    'Schulze',
    'Müller',
    'Schmidt',
    'Schneider',
    'Fischer',
    'Meyer',
    'Mayer',
    'Weber',
    'Wagner',
    'Becker',
    'Hoffmann',
    'Schäfer',
    'Koch',
    'Bauer',
    'Richter',
    'Klein',
    'Neumann',
    'Krause',
    'Lehmann',
    'Karl',
    'Hans',
    'Lena',
    'Mona',
    'Lisa',
    'Paul',
    'Leon',
    'Emma',
    'Hana',
    'Lang',
    'Stern',
    'Rose',
    'Mark',
    'Sonne',
  ];

  it.each([
    'Die Schule fängt um acht an und der Schutz ist wichtig.',
    'Die Schüler gingen in den Schulen über den Schulhof.',
    'Ein Schritt nach vorn, dann ein Schnitt und ein Schaden.',
    'Der Bäcker backt, das Becken ist voll.',
    'Der Kerl hat ein Haus, eine Hand und einen Hase.',
    'Er kocht, die kleine Katze schläft, das Land ist weit.',
    'Der Meter, der Maler und die Bauern auf dem Markt.',
    'Die Fische schwimmen, die Leute schneiden Brot richtig.',
    'Der Mond scheint, die Liste ist voll, die Pause kurz.',
    'Im Leben gibt es Sterne, Sonnen, Rosen und Marken.',
    'Die Mutter, der Vater und die Schulter tun weh.',
    'Er richtet sich auf, sie lehnt sich zurück.',
  ])('finds no common name in %j', (line) => {
    expect(found([line], COMMON_NAMES)).toEqual([]);
  });

  it('works as a detector with the work name', async () => {
    const spans = await detectNames(
      ['Liebe Grüße, deine Mia'],
      { workName: 'Mia Schulz 7b.pdf', language: 'de' },
      new AbortController().signal,
    );
    expect(spans).toEqual([
      {
        kind: 'identifier',
        category: 'person',
        source: 'name-list',
        line: 1,
        offset: 19,
        length: 3,
      },
    ]);
  });
});
