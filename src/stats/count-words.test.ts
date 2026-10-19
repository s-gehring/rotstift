import { describe, expect, it } from 'vitest';
import { countWords } from './count-words.ts';

describe('countWords', () => {
  it('returns zero for empty or whitespace-only text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  \n\t ')).toBe(0);
  });

  it('counts German words with umlauts and ß', () => {
    expect(countWords('Die Straße führt über die Brücke.')).toBe(6);
  });

  it('counts hyphenated compounds as one word', () => {
    expect(countWords('Sie schrieb eine E-Mail an die Deutsch-Lehrerin.')).toBe(7);
  });

  it('ignores standalone punctuation and dashes', () => {
    expect(countWords('Erstens - und das ist wichtig - zweitens !')).toBe(6);
  });

  it('splits on line breaks and repeated spaces', () => {
    expect(countWords('Zeile eins\nZeile   zwei\r\nZeile drei')).toBe(6);
  });

  it('counts numbers as words', () => {
    expect(countWords('Im Jahr 2026 gab es 3 Klassenarbeiten.')).toBe(7);
  });
});
