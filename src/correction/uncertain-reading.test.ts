import { describe, expect, it } from 'vitest';
import { transcriptSchema, type Mark, type Transcript } from '../annotations/transcript.ts';
import {
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

const reading = (words: [string, number][], uncertainBelow = 0.95): PageReading => ({
  words: words.map(([text, confidence]) => ({ text, confidence })),
  uncertainBelow,
});

describe('readWords', () => {
  it('keeps the lowest token probability of each word of the parsed lines', () => {
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
    const words = readWords(content, tokens, ['Das Hauß', 'steht']);
    expect(words?.map((word) => word.text)).toEqual(['Das', 'Hauß', 'steht']);
    expect(words?.map((word) => word.confidence)).toEqual([
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
  it('spreads each word confidence over its characters and treats unknown words as certain', () => {
    const words = reading([
      ['Ich', 1],
      ['Lusammen', 0.4],
      ['kam', 0.8],
    ]).words;
    expect(wordProbabilities(['Ich Lusammen', 'neu kam'], words)).toEqual([
      [1, 1, 1, 1, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4],
      [1, 1, 1, 1, 0.8, 0.8, 0.8],
    ]);
  });
});

describe('separateUncertain', () => {
  const transcript: Transcript = {
    lines: [
      {
        number: 1,
        text: 'Die Lusammenkunft war gut',
        marks: [error(4, 'Lusammenkunft', 'Zusammenkunft'), omission(21, ',')],
      },
      { number: 2, text: 'Das Hauß', marks: [error(4, 'Hauß', 'Haus')] },
    ],
  };

  it('turns marks on uncertainly read words into open hints and keeps the rest', () => {
    const separated = separateUncertain(
      transcript,
      reading([
        ['Die', 1],
        ['Lusammenkunft', 0.42],
        ['war', 0.99],
        ['gut', 1],
        ['Das', 1],
        ['Hauß', 0.96],
      ]),
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
    const separated = separateUncertain(
      transcript,
      reading([
        ['Lusammenkunft', 1],
        ['war', 0.5],
      ]),
    );
    expect(separated.hints.map((hint) => hint.mark)).toEqual([omission(21, ',')]);
  });

  it('treats everything as certain without a reading', () => {
    expect(separateUncertain(transcript, null)).toEqual({ transcript, hints: [] });
  });

  it('uses the threshold of the reading', () => {
    const words: [string, number][] = [['Hauß', 0.96]];
    expect(separateUncertain(transcript, reading(words, 0.95)).hints).toEqual([]);
    expect(separateUncertain(transcript, reading(words, 0.98)).hints).toHaveLength(1);
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
