import { describe, expect, it } from 'vitest';
import { classify, diffMarks, readCorrectedLines } from './correct-diff.ts';

describe('diffMarks', () => {
  it('marks a misspelled word as spelling error', () => {
    expect(diffMarks('Der Hunt bellt.', 'Der Hund bellt.')).toEqual([
      { kind: 'error', type: 'R', original: 'Hunt', correction: 'Hund', offset: 4 },
    ]);
  });

  it('keeps shared trailing punctuation out of the mark', () => {
    expect(diffMarks('Er ist heftich. Dann', 'Er ist heftig. Dann')).toEqual([
      { kind: 'error', type: 'R', original: 'heftich', correction: 'heftig', offset: 7 },
    ]);
  });

  it('marks an added comma as omission behind the word', () => {
    expect(diffMarks('Ich glaube dass er kommt', 'Ich glaube, dass er kommt')).toEqual([
      { kind: 'omission', type: 'Z', original: '', correction: ',', offset: 10 },
    ]);
  });

  it('marks a removed comma as punctuation error', () => {
    expect(diffMarks('Ich glaube, , dass er kommt', 'Ich glaube, dass er kommt')).toEqual([
      { kind: 'error', type: 'Z', original: ',', correction: '', offset: 12 },
    ]);
  });

  it('marks a missing word as omission', () => {
    expect(diffMarks('Er hat Hunger', 'Er hat großen Hunger')).toEqual([
      { kind: 'omission', type: 'G', original: '', correction: 'großen', offset: 6 },
    ]);
  });

  it('marks a split compound as one spelling error', () => {
    expect(diffMarks('Wir gehen zum essen', 'Wir gehen zum Essen')).toEqual([
      { kind: 'error', type: 'R', original: 'essen', correction: 'Essen', offset: 14 },
    ]);
  });

  it('splits adjacent single-word changes into separate marks', () => {
    expect(diffMarks('Es war kalt das ich fror', 'Es war kalt, dass ich fror')).toEqual([
      { kind: 'omission', type: 'Z', original: '', correction: ',', offset: 11 },
      { kind: 'error', type: 'R', original: 'das', correction: 'dass', offset: 12 },
    ]);
  });

  it('ignores typographic quotes the model substituted', () => {
    expect(diffMarks('Der "Niwa" russisch', 'Der „Niwa“ russisch')).toEqual([]);
  });

  it('keeps the offset right when only the trailing quote differs', () => {
    expect(diffMarks('Der "Niwa" russisch', 'Der „Niwa“, russisch')).toEqual([
      { kind: 'omission', type: 'Z', original: '', correction: ',', offset: 10 },
    ]);
  });

  it('skips rewrites that change more than three words in a row', () => {
    expect(diffMarks('a b c d e f', 'a x y z w f')).toEqual([]);
  });

  it('returns nothing for identical lines', () => {
    expect(diffMarks('Alles richtig.', 'Alles richtig.')).toEqual([]);
  });
});

describe('classify', () => {
  it('detects spelling, punctuation and grammar changes', () => {
    expect(classify('erlaubnis', 'Erlaubnis')).toBe('R');
    expect(classify('zum essen', 'zum Essen')).toBe('R');
    expect(classify('kalt,', 'kalt')).toBe('Z');
    expect(classify('zusammen schreiben', 'zusammenschreiben')).toBe('R');
    expect(classify('Wegen dem Regen', 'Wegen des Regens')).toBe('G');
  });
});

describe('readCorrectedLines', () => {
  const input = {
    lines: [
      { number: 1, text: 'a', marks: [] },
      { number: 2, text: 'b', marks: [] },
    ],
  };

  it('reads numbered lines and reports missing ones', () => {
    const result = readCorrectedLines(input, '1: Eins\nSonstiges');
    expect(result.corrected.get(1)).toBe('Eins');
    expect(result.issues).toEqual(['Zeile 2 fehlt in der Ausgabe.']);
  });
});
