import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { at } from '../correction/at.ts';
import { deriveMarks } from '../correction/derive.ts';
import { pseudonymize } from './pseudonymize.ts';
import { restoreCorrection, restorePlaceholders, restoreReview } from './restore.ts';
import type { IdentifierCategory, PrivacySource, PrivacySpan } from './types.ts';

function spansOf(lines: readonly string[], texts: readonly string[]): PrivacySpan[] {
  return lines.flatMap((line, index) =>
    texts.flatMap((text) => {
      const spans: PrivacySpan[] = [];
      for (let offset = line.indexOf(text); offset >= 0; offset = line.indexOf(text, offset + 1)) {
        spans.push({
          kind: 'identifier',
          category: 'person',
          source: 'name-list',
          line: index + 1,
          offset,
          length: text.length,
        });
      }
      return spans;
    }),
  );
}

function correct(
  lines: readonly string[],
  names: readonly string[],
  answer: (sent: readonly string[]) => string,
) {
  const page = pseudonymize(lines, spansOf(lines, names));
  const text = restoreCorrection(page, answer(page.lines), DEUTSCH);
  if (text === null) throw new Error('nicht zurückgesetzt');
  const marks = deriveMarks(lines, text, { profile: DEUTSCH }).flatMap((line) =>
    line.marks.map((mark) => ({ line: line.number, ...mark })),
  );
  return { page, text, marks };
}

function touches(
  lines: readonly string[],
  names: readonly string[],
  marks: ReturnType<typeof correct>['marks'],
) {
  const spans = spansOf(lines, names);
  return marks.filter((mark) =>
    spans.some(
      (span) =>
        span.line === mark.line &&
        (mark.kind === 'omission'
          ? span.offset < mark.offset && mark.offset < span.offset + span.length
          : mark.offset < span.offset + span.length &&
            span.offset < mark.offset + mark.original.length),
    ),
  );
}

describe('restoreCorrection', () => {
  it.each([
    [['Mia Schulz kam.'], ['Mia Schulz']],
    [['Mias Hund', 'und Mia.'], ['Mia']],
    [['  Mia  ', '', 'Mia,Mia'], ['Mia']],
    [
      ['Gruß, Ma-', 'rek'],
      ['Ma-', 'rek'],
    ],
    [['[Person 1] heißt Mia'], ['Mia']],
    [['Mia[Person 1]Mia'], ['Mia']],
    [['Ohne Namen.'], ['Mia']],
    [[''], []],
  ])('restores %j unchanged when the corrector changes nothing', (lines, names) => {
    const { text } = correct(lines, names, (sent) => sent.join('\n'));
    expect(text).toBe(lines.join('\n'));
  });

  it('places marks next to placeholders at the right offsets in the original', () => {
    const lines = ['Gestern sagte Mia Schulz das sie ire', 'Hausaufgaben vergesen hat.'];
    const { marks } = correct(lines, ['Mia Schulz'], () =>
      ['Gestern sagte [Person 1], dass sie ihre', 'Hausaufgaben vergessen hat.'].join('\n'),
    );
    expect(
      marks.map(({ line, kind, original, correction, offset }) => [
        line,
        kind,
        original,
        correction,
        offset,
      ]),
    ).toEqual([
      [1, 'omission', '', ',', 24],
      [1, 'error', 'das', 'dass', 25],
      [1, 'error', 'ire', 'ihre', 33],
      [2, 'error', 'vergesen', 'vergessen', 13],
    ]);
  });

  it.each([
    ['changes a placeholder', 'Gestern hat [person 1] ihre Hausaufgaben vergessen.'],
    ['breaks a placeholder', 'Gestern hat [Persn 1] ihre Hausaufgaben vergessen.'],
    ['invents a placeholder', 'Gestern hat [Person 7] ihre Hausaufgaben vergessen.'],
    ['drops a placeholder', 'Gestern hat ihre Hausaufgaben vergessen.'],
    ['duplicates a placeholder', 'Gestern hat [Person 1] [Person 1] ihre Hausaufgaben vergessen.'],
    ['adds to a placeholder', 'Gestern hat [Person 1]a ihre Hausaufgaben vergessen.'],
    ['splits a placeholder', 'Gestern hat [Person\n1] ihre Hausaufgaben vergessen.'],
    [
      'writes a placeholder elsewhere',
      'Gestern hat [Person 1] [Ort 1] ihre Hausaufgaben vergessen.',
    ],
  ])('keeps the original name and other marks when the model %s', (_case, answer) => {
    const lines = ['Gestern hat Mia ire Hausaufgaben vergesen.'];
    const { text, marks } = correct(lines, ['Mia'], () => answer);
    expect(text).toContain('Mia');
    expect(text).not.toMatch(/\[|\]/u);
    expect(touches(lines, ['Mia'], marks)).toEqual([]);
    expect(marks.map((mark) => mark.original)).toContain('vergesen');
  });

  it.each([
    ['genitive apostrophe', ['Mias Hund bellt.'], "[Person 1]'s Hund bellt."],
    ['glued letter', ['Mias Hund bellt.'], '[Person 1]a Hund bellt.'],
    ['glued word', ['Mia geht.'], '[Person 1]geht.'],
    ['hyphenated', ['Mia geht.'], '[Person 1]-geht.'],
    ['joined across a line', ['Gruß, Ma-', 'rek und Ben'], 'Gruß, [Person 1] [Person 2] und Ben'],
  ])('drops marks touching a name for a %s', (_case, lines, answer) => {
    const { marks } = correct(lines, ['Mia', 'Ma-', 'rek'], () => answer);
    expect(touches(lines, ['Mia', 'Ma-', 'rek'], marks)).toEqual([]);
  });

  it('drops marks that the alignment would stretch over a name', () => {
    const lines = ['Ich glaube das Mia gehn wolte hir.'];
    const { marks } = correct(
      lines,
      ['Mia'],
      () => 'Ich glaube, dass [Person 1] gehen wollte hier.',
    );
    expect(touches(lines, ['Mia'], marks)).toEqual([]);
  });

  it('puts swapped placeholders back where the originals stood', () => {
    const lines = ['Mia und Ben spielen.'];
    const { text } = correct(lines, ['Mia', 'Ben'], () => '[Person 2] und [Person 1] spielen.');
    expect(text).toBe('Mia und Ben spielen.');
  });

  it('restores every occurrence with its own spelling', () => {
    const lines = ['MIA und Mia gehn.'];
    const { text } = correct(lines, ['MIA', 'Mia'], (sent) => {
      expect(sent).toEqual(['[Person 1] und [Person 1] gehn.']);
      return '[Person 1] und [Person 1] gehen.';
    });
    expect(text).toBe('MIA und Mia gehen.');
  });

  it('works without a profile', () => {
    const page = pseudonymize(['Mia gehn.'], spansOf(['Mia gehn.'], ['Mia']));
    expect(restoreCorrection(page, '[Person 1] gehen.')).toBe('Mia gehen.');
  });
});

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'der',
  'Hund',
  'läuft',
  'über',
  'die',
  'Straße',
  ',',
  '.',
  '„Hallo“',
  'ich',
  '12',
  '(at)',
  '[Person 1]',
  'Ab-',
  'ß',
  '  ',
];
const SECRETS = ['Zorbalix', 'Quentrup', 'yvarnek@zz.de', 'Plimsoll 7', 'Ølund'];
const CATEGORIES: IdentifierCategory[] = [
  'person',
  'place',
  'institution',
  'contact',
  'date',
  'number',
];
const SOURCES: PrivacySource[] = ['rule', 'name-list', 'model', 'teacher'];

function sample(next: () => number) {
  const pick = <T>(items: readonly T[]): T => at(items, Math.floor(next() * items.length));
  const lines: string[] = [];
  const spans: PrivacySpan[] = [];
  const leaks: ((sent: readonly string[]) => boolean)[] = [];
  const count = 1 + Math.floor(next() * 5);
  for (let index = 0; index < count; index += 1) {
    let line = '';
    const words = Math.floor(next() * 9);
    for (let word = 0; word < words; word += 1) {
      const separator = line === '' || next() < 0.2 ? '' : ' ';
      if (next() < 0.25) {
        const secret = pick(SECRETS);
        line += separator;
        if (index + 1 < count && word === words - 1 && next() < 0.5) {
          const cut = 1 + Math.floor(next() * (secret.length - 1));
          const head = `${secret.slice(0, cut)}-`;
          spans.push({
            kind: 'identifier',
            category: pick(CATEGORIES),
            source: pick(SOURCES),
            line: index + 1,
            offset: line.length,
            length: head.length,
          });
          const row = index;
          leaks.push((sent) => (sent[row] ?? '').endsWith(head));
          line += head;
          lines.push(line);
          line = '';
          const tail = secret.slice(cut);
          spans.push({
            kind: 'identifier',
            category: pick(CATEGORIES),
            source: pick(SOURCES),
            line: index + 2,
            offset: 0,
            length: tail.length,
          });
          leaks.push((sent) => (sent[row + 1] ?? '').startsWith(tail));
          line = tail;
          index += 1;
          break;
        }
        spans.push({
          kind: 'identifier',
          category: pick(CATEGORIES),
          source: pick(SOURCES),
          line: index + 1,
          offset: line.length,
          length: secret.length,
        });
        leaks.push((sent) => sent.join('\n').includes(secret));
        line += secret;
      } else {
        line += separator + pick(WORDS);
      }
    }
    lines.push(line);
  }
  for (let extra = Math.floor(next() * 4); extra > 0; extra -= 1) {
    const line = 1 + Math.floor(next() * lines.length);
    const length = (lines[line - 1] ?? '').length;
    const position = {
      source: pick(['rule', 'name-list', 'model'] as const),
      line,
      offset: Math.floor(next() * (length + 2)) - 1,
      length: Math.floor(next() * 12),
    };
    spans.push(
      next() < 0.3
        ? { ...position, kind: 'sensitive', category: 'health' }
        : { ...position, kind: 'identifier', category: pick(CATEGORIES) },
    );
  }
  return { lines, spans, leaks };
}

describe('restoreCorrection with generated samples', () => {
  const next = random(20261023);
  const samples = Array.from({ length: 400 }, () => sample(next));

  it('restores the exact original after an unchanged round trip', () => {
    for (const { lines, spans } of samples) {
      const page = pseudonymize(lines, spans);
      expect(page.lines).toHaveLength(lines.length);
      expect(restoreCorrection(page, page.lines.join('\n'), DEUTSCH)).toBe(lines.join('\n'));
    }
  });

  it('never sends an original identifier', () => {
    for (const { lines, spans, leaks } of samples) {
      const sent = pseudonymize(lines, spans).lines;
      expect(leaks.filter((leak) => leak(sent))).toEqual([]);
    }
  });
});

describe('restoreReview', () => {
  const originals = new Map([
    ['[Person 1]', 'Mia'],
    ['[Ort 1]', 'Kassel'],
  ]);

  it('puts originals into comments and leaves unknown placeholders alone', () => {
    expect(
      restoreReview(
        {
          ok: true,
          questions: 2,
          comments: [
            { pageId: 'a', line: 2, kind: 'content', text: 'Gruß an [Person 1] fehlt' },
            { pageId: 'b', line: 1, kind: 'form', text: '[Ort 1] und [Person 9]?' },
          ],
        },
        originals,
      ),
    ).toEqual({
      ok: true,
      questions: 2,
      comments: [
        { pageId: 'a', line: 2, kind: 'content', text: 'Gruß an Mia fehlt' },
        { pageId: 'b', line: 1, kind: 'form', text: 'Kassel und [Person 9]?' },
      ],
    });
  });

  it('passes errors through', () => {
    const failed = { ok: false, error: { kind: 'cancelled' } } as const;
    expect(restoreReview(failed, originals)).toBe(failed);
  });

  it('restores placeholders in plain text', () => {
    expect(restorePlaceholders('[Ort 1]: [Ort 2]', originals)).toBe('Kassel: [Ort 2]');
  });
});
