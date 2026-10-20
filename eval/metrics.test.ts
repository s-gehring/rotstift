import { describe, expect, it } from 'vitest';
import {
  alignWords,
  characterEdits,
  classifyErrors,
  cleanTranscript,
  editDistance,
  normalize,
  rate,
  wordEdits,
} from './metrics.ts';
import { parseSample } from './sample.ts';

describe('normalize', () => {
  it('collapses whitespace and folds typographic quotes and dashes', () => {
    expect(normalize('  „Das Brot“\n\nvon  Borchert – 1946 ')).toBe(
      '"Das Brot" von Borchert - 1946',
    );
  });

  it('keeps case and punctuation', () => {
    expect(normalize('Wegen dem Regen, sind')).toBe('Wegen dem Regen, sind');
  });
});

describe('cleanTranscript', () => {
  it('drops reasoning blocks and code fences', () => {
    expect(cleanTranscript('<think>hmm</think>\n```text\nHallo Welt\n```')).toBe('Hallo Welt');
  });
});

describe('error rates', () => {
  it('computes the edit distance', () => {
    expect(editDistance(Array.from('kitten'), Array.from('sitting'))).toBe(3);
    expect(editDistance([], ['a'])).toBe(1);
  });

  it('is zero for identical text up to whitespace', () => {
    expect(characterEdits('Ein Haus.', 'Ein  Haus.\n')).toEqual({ edits: 0, total: 9 });
    expect(wordEdits('Ein Haus.', 'Ein\nHaus.')).toEqual({ edits: 0, total: 2 });
  });

  it('counts autocorrected student errors as transcription errors', () => {
    expect(rate(characterEdits('das ist', 'dass ist'))).toBeCloseTo(1 / 7);
    expect(rate(wordEdits('das ist', 'dass ist'))).toBe(0.5);
  });
});

describe('alignWords', () => {
  it('maps every reference word to its hypothesis words', () => {
    expect(alignWords(['Statt', 'dessen', 'tut'], ['Stattdessen', 'tut'])).toEqual([
      ['Stattdessen'],
      [],
      ['tut'],
    ]);
  });

  it('attaches inserted words to the preceding reference word', () => {
    expect(alignWords(['ein', 'Haus'], ['ein', 'großes', 'Haus'])).toEqual([
      ['ein', 'großes'],
      ['Haus'],
    ]);
  });
});

describe('classifyErrors', () => {
  const sample = parseSample(
    'Das Wasser war so kalt{|,|Z} {das|dass|R} ich schrie. {Statt dessen|Stattdessen|R} lief ich.',
  );

  it('recognises preserved errors', () => {
    const results = classifyErrors(sample, sample.written);
    expect(results.map((result) => result.outcome)).toEqual([
      'preserved',
      'preserved',
      'preserved',
    ]);
  });

  it('recognises autocorrected errors', () => {
    const results = classifyErrors(sample, sample.corrected);
    expect(results.map((result) => result.outcome)).toEqual([
      'corrected',
      'corrected',
      'corrected',
    ]);
  });

  it('marks other readings as misread', () => {
    const results = classifyErrors(
      sample,
      'Das Wasser war so kalt; daß ich schrie. Statt dessen lief ich.',
    );
    expect(results.map((result) => [result.transcribed, result.outcome])).toEqual([
      ['kalt;', 'misread'],
      ['daß', 'misread'],
      ['Statt dessen', 'preserved'],
    ]);
  });
});
