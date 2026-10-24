import { describe, expect, it } from 'vitest';
import type { ChatRequest } from '../llm/types.ts';
import {
  chunkLines,
  cleanItems,
  createModelDetector,
  locateQuotes,
  parseAnswer,
  privacyRequest,
  type AskModel,
  type QuoteItem,
} from './model-detector.ts';
import type {
  Detector,
  DetectorContext,
  IdentifierCategory,
  PrivacySpan,
  SensitiveCategory,
} from './types.ts';

const context: DetectorContext = { workName: 'Becker Tom 6a.pdf', language: 'de' };

const identifier = (quote: string, category: IdentifierCategory = 'person'): QuoteItem => ({
  quote,
  kind: 'identifier',
  category,
});

const sensitive = (quote: string, category: SensitiveCategory): QuoteItem => ({
  quote,
  kind: 'sensitive',
  category,
});

function covered(lines: readonly string[], spans: readonly PrivacySpan[]) {
  return spans.map((span) => [
    span.line,
    (lines[span.line - 1] ?? '').slice(span.offset, span.offset + span.length),
  ]);
}

function uniquePlaces(spans: readonly PrivacySpan[]) {
  return [
    ...new Set(spans.map((span) => `${span.kind}:${span.line}:${span.offset}:${span.length}`)),
  ];
}

function answer(
  identifiers: readonly [string, string][] = [],
  sensitives: readonly [string, string][] = [],
): string {
  return JSON.stringify({
    kennungen: identifiers.map(([zitat, kategorie]) => ({ zitat, kategorie })),
    sensibel: sensitives.map(([zitat, kategorie]) => ({ zitat, kategorie })),
  });
}

function userMessage(request: ChatRequest): string {
  const content = request.messages.find((message) => message.role === 'user')?.content;
  return typeof content === 'string' ? content : '';
}

const wordsOf = (count: number) => Array.from({ length: count }, (_, i) => `Wort${i}`).join(' ');
const filler = (index: number) => `${'wort '.repeat(190)}${index}`;
const lineOf = (size: number, fill = 'a') => fill.repeat(size);
const failing: AskModel = () => Promise.reject(new Error('Modell abgestürzt'));

function scripted(replies: Readonly<Record<string, string>>) {
  const calls: { model: string; request: ChatRequest; signal: AbortSignal }[] = [];
  const ask: AskModel = (model, request, signal) => {
    calls.push({ model, request, signal });
    return Promise.resolve(replies[model] ?? answer());
  };
  return { ask, calls };
}

function run(detector: Detector, lines: readonly string[], ctx: DetectorContext = context) {
  return detector(lines, ctx, new AbortController().signal);
}

describe('privacyRequest', () => {
  it('puts file name, subject and task into the header above the text', () => {
    const request = privacyRequest(['Zeile eins', 'Zeile zwei'], {
      ...context,
      subject: 'Englisch',
      task: 'Schreibe an Herrn Stein über dein Wochenende.',
    });
    expect(userMessage(request)).toBe(
      [
        'Name der Datei: Becker Tom 6a.pdf',
        'Fach: Englisch',
        'Aufgabenstellung: Schreibe an Herrn Stein über dein Wochenende.',
        '',
        'Text:',
        'Zeile eins',
        'Zeile zwei',
      ].join('\n'),
    );
  });

  it('falls back to Deutsch and no task when neither is given', () => {
    const header = userMessage(privacyRequest(['x'], context)).split('\n');
    expect(header[1]).toBe('Fach: Deutsch');
    expect(header[2]).toBe('Aufgabenstellung: keine');
  });

  it('treats an empty task like a missing one', () => {
    const header = userMessage(privacyRequest(['x'], { ...context, task: '' })).split('\n');
    expect(header[2]).toBe('Aufgabenstellung: keine');
  });

  it('asks deterministically for the personenbezug JSON schema with 48 character quotes', () => {
    const request = privacyRequest(['x'], context);
    expect(request.temperature).toBe(0);
    expect(request.messages[0]?.role).toBe('system');
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'personenbezug',
        schema: {
          required: ['kennungen', 'sensibel'],
          properties: {
            kennungen: {
              items: {
                required: ['zitat', 'kategorie'],
                properties: {
                  zitat: { type: 'string', maxLength: 48 },
                  kategorie: {
                    enum: ['Person', 'Ort', 'Einrichtung', 'Kontakt', 'Datum', 'Nummer'],
                  },
                },
              },
            },
            sensibel: {
              items: {
                properties: {
                  zitat: { maxLength: 48 },
                  kategorie: {
                    enum: [
                      'Gesundheit',
                      'Herkunft',
                      'Religion',
                      'Politik',
                      'Sexualität',
                      'Gewerkschaft',
                      'Lebensumstände',
                    ],
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});

describe('parseAnswer', () => {
  it('maps German labels to categories and keeps identifiers before sensitive items', () => {
    const items = parseAnswer(
      answer(
        [
          ['Lena', 'Person'],
          ['Altenstadt', 'Ort'],
          ['TSV Altenstadt', 'Einrichtung'],
          ['lena@example.org', 'Kontakt'],
          ['12.03.2011', 'Datum'],
          ['DE12 3456', 'Nummer'],
        ],
        [
          ['hat Asthma', 'Gesundheit'],
          ['aus Syrien', 'Herkunft'],
          ['betet', 'Religion'],
          ['wählt', 'Politik'],
          ['schwul', 'Sexualität'],
          ['in der Gewerkschaft', 'Gewerkschaft'],
          ['Jugendamt', 'Lebensumstände'],
        ],
      ),
    );
    expect(items.map((item) => [item.kind, item.category])).toEqual([
      ['identifier', 'person'],
      ['identifier', 'place'],
      ['identifier', 'institution'],
      ['identifier', 'contact'],
      ['identifier', 'date'],
      ['identifier', 'number'],
      ['sensitive', 'health'],
      ['sensitive', 'origin'],
      ['sensitive', 'religion'],
      ['sensitive', 'politics'],
      ['sensitive', 'sexuality'],
      ['sensitive', 'union'],
      ['sensitive', 'circumstances'],
    ]);
  });

  it('extracts the JSON object from prose and code fences around it', () => {
    const content = `Hier ist das Ergebnis:\n\`\`\`json\n${answer([['Lena', 'Person']])}\n\`\`\`\nViel Erfolg!`;
    expect(parseAnswer(content)).toEqual([identifier('Lena')]);
  });

  it('trims quotes', () => {
    expect(parseAnswer(answer([['  Lena \n', 'Person']]))).toEqual([identifier('Lena')]);
  });

  it.each([
    ['empty string', ''],
    ['no braces', 'keine Kennungen gefunden'],
    ['closing before opening brace', '} {'],
    ['truncated JSON', '{"kennungen":[{"zitat":"Lena","kategorie":"Per'],
    ['trailing comma', '{"kennungen":[{"zitat":"Lena","kategorie":"Person"},],"sensibel":[]}'],
    ['two objects glued together', '{"kennungen":[]} {"sensibel":[]}'],
    ['array root', '[{"zitat":"Lena","kategorie":"Person"}]'],
    ['unrelated object', '{"foo":"bar"}'],
    ['null lists', '{"kennungen":null,"sensibel":null}'],
    ['lists as objects', '{"kennungen":{"zitat":"Lena","kategorie":"Person"},"sensibel":"x"}'],
    [
      'inherited labels',
      '{"kennungen":[{"zitat":"Lena","kategorie":"constructor"}],"sensibel":[{"zitat":"Asthma","kategorie":"toString"}]}',
    ],
  ])('returns nothing for %s', (_name, content) => {
    expect(parseAnswer(content)).toEqual([]);
  });

  it('skips entries with wrong shapes and keeps the valid ones', () => {
    const content = JSON.stringify({
      kennungen: [
        null,
        'Lena',
        42,
        [],
        { zitat: 'ohne Kategorie' },
        { kategorie: 'Person' },
        { zitat: 7, kategorie: 'Person' },
        { zitat: '   ', kategorie: 'Person' },
        { zitat: 'Lena', kategorie: 'Unbekannt' },
        { zitat: 'Lena', kategorie: 'Gesundheit' },
        { zitat: 'Lena', kategorie: 'person' },
        { zitat: 'Lena', kategorie: 42 },
        { zitat: 'Kalle', kategorie: 'Person' },
      ],
      sensibel: [
        { zitat: 'Kalle', kategorie: 'Person' },
        { zitat: 'Asthma', kategorie: 'Gesundheit' },
      ],
    });
    expect(parseAnswer(content)).toEqual([identifier('Kalle'), sensitive('Asthma', 'health')]);
  });

  it('still parses when only one of the two lists is present', () => {
    expect(parseAnswer('{"sensibel":[{"zitat":"Asthma","kategorie":"Gesundheit"}]}')).toEqual([
      sensitive('Asthma', 'health'),
    ]);
  });
});

describe('cleanItems', () => {
  it('cuts role words in front of names, also stacked and in any case', () => {
    const cleaned = cleanItems(
      [
        identifier('Frau Wolf'),
        identifier('Liebe Oma Anna'),
        identifier('MEINE Tante Lena'),
        identifier('Dr. Weber'),
        identifier('Herrn Stein'),
      ],
      undefined,
    );
    expect(cleaned.map((item) => item.quote)).toEqual(['Wolf', 'Anna', 'Lena', 'Weber', 'Stein']);
  });

  it('keeps names that merely start with a role word', () => {
    expect(cleanItems([identifier('Herrmann'), identifier('Opaline')], undefined)).toEqual([
      identifier('Herrmann'),
      identifier('Opaline'),
    ]);
  });

  it.each<[IdentifierCategory, number]>([
    ['person', 4],
    ['place', 8],
    ['institution', 8],
    ['contact', 12],
    ['date', 12],
    ['number', 12],
  ])('drops %s quotes above %i words and keeps those at the limit', (category, limit) => {
    const kept = cleanItems([identifier(wordsOf(limit), category)], undefined);
    const dropped = cleanItems([identifier(wordsOf(limit + 1), category)], undefined);
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual([]);
  });

  it('counts words after role words were cut', () => {
    const quote = 'Frau Anna Lena Marie Sophie';
    expect(cleanItems([identifier(quote)], undefined)).toEqual([
      identifier('Anna Lena Marie Sophie'),
    ]);
  });

  it('never limits the length of sensitive quotes', () => {
    const quote = Array.from({ length: 30 }, (_, i) => `wort${i}`).join(' ');
    expect(cleanItems([sensitive(quote, 'circumstances')], undefined)).toEqual([
      sensitive(quote, 'circumstances'),
    ]);
  });

  it('drops person quotes made only of task words', () => {
    const task = 'Schreibe an Herrn Stein über dein Wochenende.';
    const cleaned = cleanItems(
      [
        identifier('Stein'),
        identifier('Herr Stein'),
        identifier('stein'),
        identifier('Stein Lena'),
        identifier('Lena'),
      ],
      task,
    );
    expect(cleaned.map((item) => item.quote)).toEqual(['Stein Lena', 'Lena']);
  });

  it('applies the task word filter to persons only', () => {
    const task = 'Beschreibe die Bergstraße und die Schule Altenstadt.';
    const cleaned = cleanItems(
      [identifier('Altenstadt', 'place'), identifier('Altenstadt', 'institution')],
      task,
    );
    expect(cleaned).toHaveLength(2);
  });

  it('keeps persons that share only some words with the task', () => {
    expect(cleanItems([identifier('Anna Stein')], 'Schreibe an Stein.')).toEqual([
      identifier('Anna Stein'),
    ]);
  });

  it('keeps persons when there is no task', () => {
    expect(cleanItems([identifier('Stein')], undefined)).toEqual([identifier('Stein')]);
  });

  describe('sensitive overrides', () => {
    const identifierCategories: IdentifierCategory[] = [
      'person',
      'place',
      'institution',
      'contact',
      'date',
      'number',
    ];
    const sensitiveCategories: SensitiveCategory[] = [
      'health',
      'origin',
      'religion',
      'politics',
      'sexuality',
      'union',
      'circumstances',
    ];
    const overriding: Readonly<Record<IdentifierCategory, readonly SensitiveCategory[]>> = {
      person: [],
      place: ['origin'],
      institution: ['union', 'politics'],
      contact: sensitiveCategories,
      date: [],
      number: [],
    };

    const pairs = identifierCategories.flatMap((idCategory) =>
      sensitiveCategories.map((sensitiveCategory): [IdentifierCategory, SensitiveCategory] => [
        idCategory,
        sensitiveCategory,
      ]),
    );

    it.each(pairs)(
      'decides for %s inside a quote of %s as specified',
      (idCategory, sensitiveCategory) => {
        const items = [
          identifier('Altenstadt', idCategory),
          sensitive('Familie aus Altenstadt geflohen', sensitiveCategory),
        ];
        const identifiers = cleanItems(items, undefined).filter(
          (item) => item.kind === 'identifier',
        );
        expect(identifiers.length === 0).toBe(overriding[idCategory].includes(sensitiveCategory));
      },
    );

    it('keeps the sensitive item itself in every case', () => {
      const items = [identifier('Altenstadt', 'contact'), sensitive('in Altenstadt', 'health')];
      expect(cleanItems(items, undefined)).toEqual([sensitive('in Altenstadt', 'health')]);
    });

    it('only drops identifiers whose quote lies inside the sensitive quote', () => {
      const items = [
        identifier('Köln', 'place'),
        identifier('Berlin', 'place'),
        sensitive('Flucht aus Köln', 'origin'),
      ];
      expect(cleanItems(items, undefined)).toEqual([
        identifier('Berlin', 'place'),
        sensitive('Flucht aus Köln', 'origin'),
      ]);
    });

    it('compares ignoring case, hyphens, whitespace and edge punctuation', () => {
      const items = [
        identifier('Bad Homburg', 'place'),
        identifier('Nord-Rhein', 'place'),
        sensitive('Wir kommen aus  BAD   HOMBURG.', 'origin'),
        sensitive('aus nordrhein', 'origin'),
      ];
      expect(cleanItems(items, undefined).filter((item) => item.kind === 'identifier')).toEqual([]);
    });

    it('compares after role words were cut', () => {
      const items = [identifier('Frau Wolf', 'contact'), sensitive('Wolf hat Krebs', 'health')];
      expect(cleanItems(items, undefined)).toEqual([sensitive('Wolf hat Krebs', 'health')]);
    });
  });
});

describe('locateQuotes', () => {
  it('finds every exact occurrence on all lines, ignoring case', () => {
    const lines = ['Lena ging zu Lena.', 'Am Abend rief LENA an.'];
    const spans = locateQuotes(lines, [identifier('Lena')]);
    expect(covered(lines, spans)).toEqual([
      [1, 'Lena'],
      [1, 'Lena'],
      [2, 'LENA'],
    ]);
    expect(spans.map((span) => span.offset)).toEqual([0, 13, 14]);
    expect(spans.every((span) => span.kind === 'identifier' && span.category === 'person')).toBe(
      true,
    );
    expect(spans.every((span) => span.source === 'model')).toBe(true);
  });

  it('does not match inside longer words', () => {
    const lines = ['Hannalena und Lenara und Lena'];
    expect(covered(lines, locateQuotes(lines, [identifier('Anna'), identifier('Lena')]))).toEqual([
      [1, 'Lena'],
    ]);
  });

  it('matches a name followed by a genitive s, covering only the name', () => {
    const lines = ['Ninas Oma und Nina’s Hund'];
    expect(covered(lines, locateQuotes(lines, [identifier('Nina')]))).toEqual([
      [1, 'Nina'],
      [1, 'Nina'],
    ]);
  });

  it('carries sensitive categories through to the spans', () => {
    const lines = ['Kalle hat Asthma.'];
    const spans = locateQuotes(lines, [sensitive('hat Asthma', 'health')]);
    expect(covered(lines, spans)).toEqual([[1, 'hat Asthma']]);
    expect(spans[0]).toMatchObject({ kind: 'sensitive', category: 'health', source: 'model' });
  });

  it('keeps a multi word quote on one line as a single span', () => {
    const lines = ['Ich wohne in der Bergstraße 4 in Altenstadt.'];
    expect(covered(lines, locateQuotes(lines, [identifier('Bergstraße 4', 'place')]))).toEqual([
      [1, 'Bergstraße 4'],
    ]);
  });

  it('splits a quote spanning a line break into one span per line', () => {
    const lines = ['Mein Freund Tom', 'Becker kommt aus Köln'];
    const spans = locateQuotes(lines, [identifier('Tom Becker')]);
    expect(covered(lines, spans)).toEqual([
      [1, 'Tom'],
      [2, 'Becker'],
    ]);
  });

  it('finds a word hyphenated across lines when quoted without the hyphen', () => {
    const lines = ['Ich wohne in der Berg-', 'straße in Altenstadt.'];
    const spans = locateQuotes(lines, [identifier('Bergstraße', 'place')]);
    expect(covered(lines, spans)).toEqual([
      [1, 'Berg'],
      [2, 'straße'],
    ]);
  });

  it('finds a quote whose own hyphen differs from the text', () => {
    const lines = ['Sie wohnt in Bad-Homburg.'];
    expect(covered(lines, locateQuotes(lines, [identifier('Bad Homburg', 'place')]))).toEqual([]);
    expect(covered(lines, locateQuotes(lines, [identifier('BadHomburg', 'place')]))).toEqual([
      [1, 'Bad-Homburg'],
    ]);
  });

  it('falls back to a fuzzy match when the model quote has a small typo', () => {
    const lines = ['Wir fahren nach Altnstadt zu Oma.'];
    expect(covered(lines, locateQuotes(lines, [identifier('Altenstadt', 'place')]))).toEqual([
      [1, 'Altnstadt'],
    ]);
  });

  it('fuzzy matches multi word quotes and picks the closest candidate only', () => {
    const lines = ['Tom Beckr wohnt hier.', 'Tim Beckker nicht.'];
    expect(covered(lines, locateQuotes(lines, [identifier('Tom Becker')]))).toEqual([
      [1, 'Tom Beckr'],
    ]);
  });

  it('does not match fuzzily beyond a quarter of the quote length', () => {
    const lines = ['Wir fahren nach Altendorf zu Oma.'];
    expect(locateQuotes(lines, [identifier('Altenstadt', 'place')])).toEqual([]);
  });

  it('does not match fuzzily for quotes shorter than three characters', () => {
    const lines = ['Der Hund ist da.'];
    expect(locateQuotes(lines, [identifier('Hu')])).toEqual([]);
  });

  it('prefers exact matches over fuzzy ones', () => {
    const lines = ['Lena und Lina und Lena'];
    expect(covered(lines, locateQuotes(lines, [identifier('Lena')]))).toEqual([
      [1, 'Lena'],
      [1, 'Lena'],
    ]);
  });

  it('ignores quotes that are not in the text at all', () => {
    expect(locateQuotes(['Heute war ein schöner Tag.'], [identifier('Kalle')])).toEqual([]);
  });

  it('ignores quotes that normalize to nothing', () => {
    expect(
      locateQuotes(['Heute war ein schöner Tag.'], [identifier('...'), identifier('--')]),
    ).toEqual([]);
  });

  it('returns nothing for empty text', () => {
    expect(locateQuotes([], [identifier('Lena')])).toEqual([]);
    expect(locateQuotes(['', ''], [identifier('Lena')])).toEqual([]);
  });

  it('keeps contact quotes that start with a plus or at sign', () => {
    const lines = ['Ruf mich an: +49 170 1234567 oder @lena_k'];
    const spans = locateQuotes(lines, [
      identifier('+49 170 1234567', 'contact'),
      identifier('@lena_k', 'contact'),
    ]);
    expect(covered(lines, spans)).toEqual([
      [1, '+49 170 1234567'],
      [1, '@lena_k'],
    ]);
  });

  it('maps offsets back correctly when the text has runs of whitespace', () => {
    const lines = ['Tom    und   Lena   kamen'];
    expect(covered(lines, locateQuotes(lines, [identifier('Lena')]))).toEqual([[1, 'Lena']]);
    expect(covered(lines, locateQuotes(lines, [identifier('Tom und Lena')]))).toEqual([
      [1, 'Tom'],
      [1, 'und'],
      [1, 'Lena'],
    ]);
  });
});

describe('chunkLines', () => {
  it('returns no chunks for no lines', () => {
    expect(chunkLines([])).toEqual([]);
  });

  it('keeps short text in one chunk', () => {
    const lines = ['eins', 'zwei', 'drei'];
    expect(chunkLines(lines)).toEqual([{ start: 0, lines }]);
  });

  it('starts a new chunk with the right start line once 3000 characters would be exceeded', () => {
    const lines = [
      lineOf(1000, 'a'),
      lineOf(1000, 'b'),
      lineOf(1000, 'c'),
      lineOf(1000, 'd'),
      lineOf(10, 'e'),
    ];
    const chunks = chunkLines(lines);
    expect(chunks.map((chunk) => [chunk.start, chunk.lines.length])).toEqual([
      [0, 2],
      [2, 3],
    ]);
    expect(chunks.flatMap((chunk) => chunk.lines)).toEqual(lines);
  });

  it('gives a single oversized line its own chunk without dropping it', () => {
    const lines = ['kurz', lineOf(5000), 'kurz'];
    expect(chunkLines(lines).map((chunk) => [chunk.start, chunk.lines.length])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
  });

  it('never loses or duplicates lines and keeps start offsets consistent', () => {
    const lines = Array.from({ length: 60 }, (_, i) => lineOf(150 + ((i * 37) % 400), 'x'));
    const chunks = chunkLines(lines);
    expect(chunks.length).toBeGreaterThan(1);
    let next = 0;
    for (const chunk of chunks) {
      expect(chunk.start).toBe(next);
      expect(chunk.lines).toEqual(lines.slice(chunk.start, chunk.start + chunk.lines.length));
      next += chunk.lines.length;
    }
    expect(next).toBe(lines.length);
  });
});

describe('createModelDetector', () => {
  const lines = [
    'Hallo, ich bin Lena Becker.',
    'Ich wohne in Altenstadt.',
    'Mein Bruder Kalle hat Asthma.',
  ];

  it('asks the model once per chunk with the request built from the chunk and context', async () => {
    const { ask, calls } = scripted({});
    const ctx = { ...context, task: 'Schreibe einen Brief.' };
    await run(createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask }), lines, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe('e2b');
    expect(calls[0]?.request).toEqual(privacyRequest(lines, ctx));
  });

  it('turns the answer into located identifier and sensitive spans', async () => {
    const { ask } = scripted({
      e2b: answer(
        [
          ['Lena Becker', 'Person'],
          ['Kalle', 'Person'],
          ['Altenstadt', 'Ort'],
        ],
        [['Kalle hat Asthma', 'Gesundheit']],
      ),
    });
    const spans = await run(
      createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask }),
      lines,
    );
    expect(covered(lines, spans)).toEqual([
      [1, 'Lena Becker'],
      [3, 'Kalle'],
      [2, 'Altenstadt'],
      [3, 'Kalle hat Asthma'],
    ]);
    expect(spans.map((span) => [span.kind, span.category])).toEqual([
      ['identifier', 'person'],
      ['identifier', 'person'],
      ['identifier', 'place'],
      ['sensitive', 'health'],
    ]);
  });

  it('asks the currently loaded model first and the others afterwards', async () => {
    const { ask, calls } = scripted({});
    const detector = createModelDetector({
      models: ['e2b', 'e4b', 'big'],
      sensitiveModel: 'e4b',
      ask,
      loaded: () => 'e4b',
    });
    await run(detector, lines);
    expect(calls.map((call) => call.model)).toEqual(['e4b', 'e2b', 'big']);
  });

  it.each([
    ['nothing is loaded', null],
    ['an unrelated model is loaded', 'other'],
  ])('keeps the configured order when %s', async (_name, loadedModel) => {
    const { ask, calls } = scripted({});
    const detector = createModelDetector({
      models: ['e2b', 'e4b'],
      sensitiveModel: 'e4b',
      ask,
      loaded: () => loadedModel,
    });
    await run(detector, lines);
    expect(calls.map((call) => call.model)).toEqual(['e2b', 'e4b']);
  });

  it('keeps the configured order without a loaded callback', async () => {
    const { ask, calls } = scripted({});
    await run(createModelDetector({ models: ['e2b', 'e4b'], sensitiveModel: 'e4b', ask }), lines);
    expect(calls.map((call) => call.model)).toEqual(['e2b', 'e4b']);
  });

  it('reads the loaded model anew on every run', async () => {
    const { ask, calls } = scripted({});
    let current: string | null = null;
    const detector = createModelDetector({
      models: ['e2b', 'e4b'],
      sensitiveModel: 'e4b',
      ask,
      loaded: () => current,
    });
    await run(detector, lines);
    current = 'e4b';
    await run(detector, lines);
    expect(calls.map((call) => call.model)).toEqual(['e2b', 'e4b', 'e4b', 'e2b']);
  });

  it('reports the union of identifiers over all models', async () => {
    const { ask } = scripted({
      e2b: answer([
        ['Lena', 'Person'],
        ['Altenstadt', 'Ort'],
      ]),
      e4b: answer([
        ['Lena', 'Person'],
        ['Kalle', 'Person'],
      ]),
    });
    const spans = await run(
      createModelDetector({ models: ['e2b', 'e4b'], sensitiveModel: 'e4b', ask }),
      lines,
    );
    const places = uniquePlaces(spans);
    expect(places).toHaveLength(3);
    expect(new Set(covered(lines, spans).map(([line, text]) => `${line}:${text}`))).toEqual(
      new Set(['1:Lena', '2:Altenstadt', '3:Kalle']),
    );
  });

  it('takes sensitive spans only from the sensitive model', async () => {
    const { ask } = scripted({
      e2b: answer([], [['Kalle hat Asthma', 'Gesundheit']]),
      e4b: answer([], [['Altenstadt', 'Herkunft']]),
    });
    const spans = await run(
      createModelDetector({ models: ['e2b', 'e4b'], sensitiveModel: 'e4b', ask }),
      lines,
    );
    expect(covered(lines, spans)).toEqual([[2, 'Altenstadt']]);
    expect(spans[0]).toMatchObject({ kind: 'sensitive', category: 'origin' });
  });

  it('reports no sensitive spans when the sensitive model found none, even if another did', async () => {
    const { ask } = scripted({
      e2b: answer([['Kalle', 'Person']], [['Kalle hat Asthma', 'Gesundheit']]),
      e4b: answer([['Kalle', 'Person']]),
    });
    const spans = await run(
      createModelDetector({ models: ['e2b', 'e4b'], sensitiveModel: 'e4b', ask }),
      lines,
    );
    expect(spans.filter((span) => span.kind === 'sensitive')).toEqual([]);
    expect(uniquePlaces(spans)).toHaveLength(1);
  });

  it('does not report sensitive spans when the sensitive model is not among the models', async () => {
    const { ask } = scripted({ e2b: answer([], [['Kalle hat Asthma', 'Gesundheit']]) });
    const spans = await run(
      createModelDetector({ models: ['e2b'], sensitiveModel: 'e4b', ask }),
      lines,
    );
    expect(spans).toEqual([]);
  });

  it('applies post-processing to the merged answers', async () => {
    const { ask } = scripted({
      e2b: answer([
        ['Frau Becker', 'Person'],
        ['Stein', 'Person'],
        ['Altenstadt', 'Ort'],
      ]),
      e4b: answer([], [['Familie aus Altenstadt', 'Herkunft']]),
    });
    const text = ['Frau Becker schrieb an Herrn Stein.', 'Sie kommt aus Altenstadt.'];
    const spans = await run(
      createModelDetector({ models: ['e2b', 'e4b'], sensitiveModel: 'e4b', ask }),
      text,
      { ...context, task: 'Schreibe an Herrn Stein.' },
    );
    expect(covered(text, spans)).toEqual([[1, 'Becker']]);
  });

  it('offsets spans by the start line of their chunk', async () => {
    const text = [
      filler(0),
      filler(1),
      filler(2),
      'Ich bin Lena Becker.',
      filler(4),
      filler(5),
      filler(6),
      'Mein Bruder Kalle.',
    ];
    const chunks = chunkLines(text);
    expect(chunks.length).toBeGreaterThan(1);

    const requests: string[] = [];
    const ask: AskModel = (_model, request) => {
      const content = userMessage(request);
      requests.push(content);
      return Promise.resolve(
        answer([
          ['Lena Becker', 'Person'],
          ['Kalle', 'Person'],
        ]),
      );
    };
    const spans = await run(
      createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask }),
      text,
    );

    expect(requests).toHaveLength(chunks.length);
    expect(covered(text, spans)).toEqual([
      [4, 'Lena Becker'],
      [8, 'Kalle'],
    ]);
  });

  it('queries every chunk with every model and keeps their answers apart', async () => {
    const text = [
      filler(0),
      filler(1),
      filler(2),
      'Hier ist Lena.',
      filler(4),
      filler(5),
      filler(6),
    ];
    const chunkCount = chunkLines(text).length;
    const calls: string[] = [];
    const ask: AskModel = (model, request) => {
      const content = userMessage(request);
      calls.push(model);
      return Promise.resolve(
        content.includes('Lena') ? answer([['Lena', 'Person']]) : answer([['Fremd', 'Person']]),
      );
    };
    const spans = await run(
      createModelDetector({ models: ['e2b', 'e4b'], sensitiveModel: 'e4b', ask }),
      text,
    );
    expect(calls).toHaveLength(2 * chunkCount);
    expect(uniquePlaces(spans)).toHaveLength(1);
    expect(new Set(covered(text, spans).map(([line, word]) => `${line}:${word}`))).toEqual(
      new Set(['4:Lena']),
    );
  });

  it('skips chunks that contain only blank lines', async () => {
    const { ask, calls } = scripted({});
    const spans = await run(createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask }), [
      '',
      '   ',
      '\t',
    ]);
    expect(spans).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('does not ask anything for empty input', async () => {
    const { ask, calls } = scripted({});
    expect(
      await run(createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask }), []),
    ).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('survives models answering with garbage', async () => {
    const { ask } = scripted({ e2b: 'Ich kann das nicht.', e4b: answer([['Lena', 'Person']]) });
    const spans = await run(
      createModelDetector({ models: ['e2b', 'e4b'], sensitiveModel: 'e4b', ask }),
      lines,
    );
    expect(covered(lines, spans)).toEqual([[1, 'Lena']]);
  });

  it('passes the abort signal on to the model', async () => {
    const { ask, calls } = scripted({});
    const controller = new AbortController();
    await createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask })(
      lines,
      context,
      controller.signal,
    );
    expect(calls[0]?.signal).toBe(controller.signal);
  });

  it('rejects without asking when the signal is already aborted', async () => {
    const { ask, calls } = scripted({});
    const controller = new AbortController();
    controller.abort(new Error('abgebrochen'));
    const result = createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask })(
      lines,
      context,
      controller.signal,
    );
    await expect(result).rejects.toThrow('abgebrochen');
    expect(calls).toEqual([]);
  });

  it('stops before the next model once aborted in between', async () => {
    const controller = new AbortController();
    const asked: string[] = [];
    const ask: AskModel = (model) => {
      asked.push(model);
      controller.abort(new Error('abgebrochen'));
      return Promise.resolve(answer([['Lena', 'Person']]));
    };
    const result = createModelDetector({ models: ['e2b', 'e4b'], sensitiveModel: 'e4b', ask })(
      lines,
      context,
      controller.signal,
    );
    await expect(result).rejects.toThrow('abgebrochen');
    expect(asked).toEqual(['e2b']);
  });

  it('stops before the next chunk once aborted in between', async () => {
    const text = Array.from({ length: 8 }, (_, i) => `${'wort '.repeat(190)}${i}`);
    const chunks = chunkLines(text).length;
    expect(chunks).toBeGreaterThan(1);
    const controller = new AbortController();
    let asked = 0;
    const ask: AskModel = () => {
      asked += 1;
      controller.abort(new Error('abgebrochen'));
      return Promise.resolve(answer());
    };
    const result = createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask })(
      text,
      context,
      controller.signal,
    );
    await expect(result).rejects.toThrow('abgebrochen');
    expect(asked).toBe(1);
  });

  it('propagates errors thrown by the model', async () => {
    const result = run(
      createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask: failing }),
      lines,
    );
    await expect(result).rejects.toThrow('Modell abgestürzt');
  });
});

const quotes = (items: readonly QuoteItem[]) =>
  cleanItems(items, undefined).map((item) => item.quote);

describe('cleanItems identifier filters', () => {
  it.each(['Mama', 'Samstag', 'Ukraine', 'SPD', 'Oktober'])('drops the plain word %j', (word) => {
    expect(quotes([identifier(word)])).toEqual([]);
  });

  it('drops class labels', () => {
    expect(
      quotes([identifier('8c', 'institution'), identifier('Klasse 7b', 'institution')]),
    ).toEqual([]);
  });

  it('drops bare numbers and times for person and date', () => {
    expect(quotes([identifier('1981', 'date'), identifier('7:40 Uhr', 'date')])).toEqual([]);
    expect(quotes([identifier('1981', 'person')])).toEqual([]);
  });

  it('drops amounts as number', () => {
    expect(quotes([identifier('340 Euro', 'number')])).toEqual([]);
  });

  it('keeps day-month dates', () => {
    expect(quotes([identifier('15.03.', 'date')])).toEqual(['15.03.']);
  });

  it('keeps five-digit postcodes as place', () => {
    expect(quotes([identifier('34117', 'place')])).toEqual(['34117']);
  });

  it('keeps phone numbers as contact', () => {
    expect(quotes([identifier('0171 2345678', 'contact')])).toEqual(['0171 2345678']);
  });
});

describe('createModelDetector with an unknownWords option', () => {
  const lines = ['Die Hausaufgaben von Lena Becker und Zorbekmeier, Hahn und Finn.'];

  async function quotesFor(items: readonly [string, string][], known: readonly string[]) {
    const { ask } = scripted({ e2b: answer(items) });
    const unknownWords = async (words: readonly string[]) =>
      new Set(words.filter((word) => !known.includes(word)));
    const spans = await run(
      createModelDetector({ models: ['e2b'], sensitiveModel: 'e2b', ask, unknownWords }),
      lines,
    );
    return covered(lines, spans).map(([, text]) => text);
  }

  it('drops a single long capitalized word the dictionary knows', async () => {
    expect(await quotesFor([['Hausaufgaben', 'Person']], ['Hausaufgaben'])).toEqual([]);
    expect(await quotesFor([['Hausaufgaben', 'Einrichtung']], ['Hausaufgaben'])).toEqual([]);
  });

  it('keeps unknown words', async () => {
    expect(await quotesFor([['Zorbekmeier', 'Person']], [])).toEqual(['Zorbekmeier']);
  });

  it('keeps first names and word surnames even when the dictionary knows them', async () => {
    expect(await quotesFor([['Finn', 'Person']], ['Finn'])).toEqual(['Finn']);
    expect(await quotesFor([['Hahn', 'Person']], ['Hahn'])).toEqual(['Hahn']);
  });

  it('keeps known words that are not a single capitalized word of 7+ letters', async () => {
    expect(await quotesFor([['Lena Becker', 'Person']], ['Lena Becker'])).toEqual(['Lena Becker']);
  });

  it('keeps a known word in other categories', async () => {
    expect(await quotesFor([['Hausaufgaben', 'Ort']], ['Hausaufgaben'])).toEqual(['Hausaufgaben']);
  });
});
