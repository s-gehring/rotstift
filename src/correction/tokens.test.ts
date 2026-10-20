import { describe, expect, it } from 'vitest';
import { joinCorrected, tokenizeCorrected, tokenizeLines } from './tokens.ts';

describe('tokenizeLines', () => {
  it('splits words and punctuation with positions', () => {
    const [line] = tokenizeLines(['Ja, „klar“!']);
    expect(line?.map((token) => [token.text, token.kind, token.parts[0]?.start])).toEqual([
      ['Ja', 'word', 0],
      [',', 'punct', 2],
      ['„', 'punct', 4],
      ['klar', 'word', 5],
      ['“', 'punct', 9],
      ['!', 'punct', 10],
    ]);
  });

  it('keeps inner hyphens and apostrophes in the word', () => {
    const [line] = tokenizeLines(["E-Mail don't"]);
    expect(line?.map((token) => token.text)).toEqual(['E-Mail', "don't"]);
  });

  it('joins a word hyphenated at the line end into one token with two parts', () => {
    const [first, second] = tokenizeLines(['Die Rut-', 'sche ist da.']);
    expect(first?.map((token) => token.text)).toEqual(['Die', 'Rutsche']);
    expect(first?.[1]?.parts).toEqual([
      { line: 0, start: 4, end: 7 },
      { line: 1, start: 0, end: 4 },
    ]);
    expect(second?.map((token) => token.text)).toEqual(['ist', 'da', '.']);
  });

  it('keeps the hyphen when the next line starts with a capital letter', () => {
    const [first] = tokenizeLines(['Die E-', 'Mail ist da.']);
    expect(first?.map((token) => token.text)).toEqual(['Die', 'E', '-']);
  });
});

describe('joinCorrected', () => {
  it('joins lines with single spaces and removes line-end hyphenation', () => {
    expect(joinCorrected('Die Rut-\nsche  ist\n\n  da.')).toBe('Die Rutsche ist da.');
  });

  it('tokenizes the joined text with offsets', () => {
    expect(
      tokenizeCorrected('Hi, du').map((token) => [token.text, token.start, token.end]),
    ).toEqual([
      ['Hi', 0, 2],
      [',', 2, 3],
      ['du', 4, 6],
    ]);
  });
});
