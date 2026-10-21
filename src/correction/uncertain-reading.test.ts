import { describe, expect, it } from 'vitest';
import { transcriptSchema, type Mark, type Transcript } from '../annotations/transcript.ts';
import {
  editReading,
  isPlausibleHint,
  nextHintStatus,
  openHints,
  readWords,
  separateUncertain,
  withAcceptedHints,
  wordProbabilities,
  type PageReading,
  type ReadingHint,
} from './uncertain-reading.ts';

const encoder = new TextEncoder();
const token = (text: string, probability: number) => ({
  bytes: Array.from(encoder.encode(text)),
  logprob: Math.log(probability),
});

const error = (offset: number, original: string, correction: string): Mark => ({
  kind: 'error',
  type: 'R',
  original,
  correction,
  offset,
});

const omission = (offset: number, correction: string): Mark => ({
  kind: 'omission',
  type: 'Z',
  original: '',
  correction,
  offset,
});

const reading = (
  lines: readonly string[],
  uncertain: Readonly<Record<string, number>>,
  uncertainBelow = 0.95,
): PageReading => ({
  lines: lines.map((line) =>
    Array.from(line.matchAll(/\S+/gu), ([text]) => ({ text, confidence: uncertain[text] ?? 1 })),
  ),
  uncertainBelow,
});

describe('readWords', () => {
  it('keeps the lowest token probability of each word, line by line', () => {
    const content = '```\nDas Hauß\nsteht\n```';
    const tokens = [
      token('```\n', 0.5),
      token('Das', 0.99),
      token(' Hau', 0.97),
      token('ß', 0.3),
      token('\nst', 1),
      token('eht', 0.9),
      token('\n```', 0.5),
    ];
    const lines = readWords(content, tokens, ['Das Hauß', 'steht']);
    expect(lines?.map((words) => words.map((word) => word.text))).toEqual([
      ['Das', 'Hauß'],
      ['steht'],
    ]);
    expect(lines?.flat().map((word) => word.confidence)).toEqual([
      expect.closeTo(0.99, 6),
      expect.closeTo(0.3, 6),
      expect.closeTo(0.9, 6),
    ]);
  });

  it('gives up when the tokens do not spell the answer', () => {
    expect(readWords('Das Haus', [token('Das', 1)], ['Das Haus'])).toBeNull();
  });
});

describe('wordProbabilities', () => {
  it('spreads each word confidence over its characters within its own line', () => {
    const { lines } = reading(['Ich  Lusammen', 'neu kam'], { Lusammen: 0.4, kam: 0.8 });
    expect(wordProbabilities(['Ich Lusammen', 'neu kam'], lines)).toEqual([
      [1, 1, 1, 1, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4],
      [1, 1, 1, 1, 0.8, 0.8, 0.8],
    ]);
  });

  it('treats a line whose words changed as certain without borrowing from other lines', () => {
    const { lines } = reading(['Die Wält ist', 'rund wie die Welt'], { Wält: 0.4, Welt: 0.6 });
    expect(wordProbabilities(['Die Welt ist', 'rund wie die Welt'], lines)).toEqual([
      Array.from('Die Welt ist', () => 1),
      [...Array.from('rund wie die ', () => 1), 0.6, 0.6, 0.6, 0.6],
    ]);
  });
});

describe('editReading', () => {
  const before = ['Die Wält ist', 'rund wie die Welt'];
  const read = reading(before, { Wält: 0.4, Welt: 0.6 });

  it('forgets the confidence of edited lines and keeps the others', () => {
    const edited = editReading(read, before, ['Die Welt ist', 'rund wie die Welt']);
    expect(edited?.lines[0]).toEqual([]);
    expect(edited?.lines[1]).toBe(read.lines[1]);
    expect(edited?.uncertainBelow).toBe(0.95);
  });

  it('drops the reading when lines were added or removed', () => {
    expect(editReading(read, before, ['Die Wält ist rund wie die Welt'])).toBeNull();
    expect(editReading(null, before, before)).toBeNull();
  });
});

describe('separateUncertain', () => {
  const texts = ['Die Lusammenkunft war gut', 'Das Hauß'];
  const transcript: Transcript = {
    lines: [
      {
        number: 1,
        text: texts[0] ?? '',
        marks: [error(4, 'Lusammenkunft', 'Zusammenkunft'), omission(21, ',')],
      },
      { number: 2, text: texts[1] ?? '', marks: [error(4, 'Hauß', 'Haus')] },
    ],
  };

  it('turns marks on uncertainly read words into open hints and keeps the rest', () => {
    const separated = separateUncertain(
      transcript,
      reading(texts, { Lusammenkunft: 0.42, war: 0.99, Hauß: 0.96 }),
    );
    expect(separated.transcript.lines.map((line) => line.marks)).toEqual([
      [omission(21, ',')],
      [error(4, 'Hauß', 'Haus')],
    ]);
    expect(separated.hints).toEqual([
      {
        line: 1,
        mark: error(4, 'Lusammenkunft', 'Zusammenkunft'),
        confidence: 0.42,
        status: 'open',
      },
    ]);
  });

  it('counts an omission as uncertain when a neighbouring word is', () => {
    const separated = separateUncertain(transcript, reading(texts, { war: 0.5 }));
    expect(separated.hints.map((hint) => hint.mark)).toEqual([omission(21, ',')]);
  });

  it('treats everything as certain without a matching reading', () => {
    expect(separateUncertain(transcript, null)).toEqual({ transcript, hints: [] });
    const shorter = reading(['Die Lusammenkunft war gut'], { Lusammenkunft: 0.1 });
    expect(separateUncertain(transcript, shorter)).toEqual({ transcript, hints: [] });
  });

  it('uses the threshold of the reading', () => {
    expect(separateUncertain(transcript, reading(texts, { Hauß: 0.96 }, 0.95)).hints).toEqual([]);
    expect(separateUncertain(transcript, reading(texts, { Hauß: 0.96 }, 0.98)).hints).toHaveLength(
      1,
    );
  });

  it('drops implausible suggestions on uncertainly read words', () => {
    const text = 'Wir haben Wirnalt dass es heftich war';
    const guessed: Transcript = {
      lines: [
        {
          number: 1,
          text,
          marks: [
            { ...error(10, 'Wirnalt', 'Wärme'), type: 'R' },
            { ...error(10, 'Wirnalt', 'gemerkt'), type: 'A' },
            error(26, 'heftich', 'heftig'),
          ],
        },
      ],
    };
    const separated = separateUncertain(guessed, reading([text], { Wirnalt: 0.3, heftich: 0.6 }));
    expect(separated.transcript.lines[0]?.marks).toEqual([]);
    expect(separated.hints.map((entry) => entry.mark.correction)).toEqual(['heftig']);
  });
});

describe('isPlausibleHint', () => {
  it('keeps small spelling changes, grammar and punctuation', () => {
    expect(isPlausibleHint(error(0, 'ausserdem', 'außerdem'))).toBe(true);
    expect(isPlausibleHint(error(0, 'Gestern', 'gestern'))).toBe(true);
    expect(isPlausibleHint({ ...error(0, 'ist', 'sei'), type: 'G' })).toBe(true);
    expect(isPlausibleHint(omission(3, ','))).toBe(true);
    expect(isPlausibleHint({ ...error(0, 'freind', 'friend'), type: 'sp' })).toBe(true);
  });

  it('drops guessed words and rewordings', () => {
    expect(isPlausibleHint(error(0, 'Wirnalt', 'Wärme'))).toBe(false);
    expect(isPlausibleHint({ ...error(0, 'lief', 'rannte'), type: 'A' })).toBe(false);
    expect(isPlausibleHint({ ...error(0, 'grand', 'big'), type: 'voc' })).toBe(false);
  });
});

const hint = (status: ReadingHint['status'], mark: Mark): ReadingHint => ({
  line: 1,
  mark,
  confidence: 0.5,
  status,
});

describe('withAcceptedHints', () => {
  const base: Transcript = {
    lines: [{ number: 1, text: 'Er kam spt nach Hause', marks: [omission(6, ',')] }],
  };

  it('adds accepted hints as ordinary marks in text order', () => {
    const merged = withAcceptedHints(base, [
      hint('accepted', error(7, 'spt', 'spät')),
      hint('accepted', error(0, 'Er', 'Sie')),
      hint('open', error(16, 'Hause', 'Haus')),
      hint('dismissed', error(12, 'nach', 'noch')),
    ]);
    expect(merged.lines[0]?.marks).toEqual([
      error(0, 'Er', 'Sie'),
      omission(6, ','),
      error(7, 'spt', 'spät'),
    ]);
    expect(transcriptSchema.safeParse(merged).success).toBe(true);
  });

  it('keeps the transcript untouched when nothing is accepted', () => {
    expect(withAcceptedHints(base, [hint('open', error(7, 'spt', 'spät'))])).toBe(base);
  });

  it('cycles open, accepted and dismissed and counts the open ones', () => {
    expect(nextHintStatus('open')).toBe('accepted');
    expect(nextHintStatus('accepted')).toBe('dismissed');
    expect(nextHintStatus('dismissed')).toBe('open');
    const mark = error(7, 'spt', 'spät');
    expect(openHints([hint('open', mark), hint('accepted', mark), hint('open', mark)])).toBe(2);
  });
});
