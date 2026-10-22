import { describe, expect, it } from 'vitest';
import { findStruckWords } from './strike.ts';
import { renderPage, sampleLines } from './synthetic.ts';

const PAGE = { width: 900, height: 1100, pitch: 48, seed: 5 };

describe('findStruckWords', () => {
  const lines = sampleLines(7, 12);

  it('finds words with a line through them', () => {
    const struck = [[1], [], [0, 3], [], [], [4], [], [], [], [], [], []];
    const page = renderPage({ ...PAGE, lines, struck, ruled: true });
    expect(findStruckWords(page.image, lines)).toEqual(struck);
  });

  it('finds words with a wavy line through them', () => {
    const struck = [[], [2], [], [], [0], [], [], [3], [], [], [], []];
    const page = renderPage({ ...PAGE, lines, struck, wavyStrikes: true, ruled: true });
    expect(findStruckWords(page.image, lines)).toEqual(struck);
  });

  it('finds nothing on a page without struck words', () => {
    for (const seed of [1, 2, 3]) {
      const page = renderPage({ ...PAGE, seed, lines, ruled: seed !== 2, margin: true });
      expect(findStruckWords(page.image, lines).flat()).toEqual([]);
    }
  });

  it('finds struck words on squared paper', () => {
    const struck = [[], [0], [], [2], [], [], [1], [], [], [], [3], []];
    const page = renderPage({ ...PAGE, lines, struck, grid: true, ruleShade: 110 });
    expect(findStruckWords(page.image, lines)).toEqual(struck);
  });

  it('finds nothing on squared paper without struck words', () => {
    for (const seed of [1, 2, 3]) {
      const page = renderPage({ ...PAGE, seed, lines, grid: true, ruleShade: 90 });
      expect(findStruckWords(page.image, lines).flat()).toEqual([]);
    }
  });

  it('finds wavy strikes on tilted squared paper', () => {
    const struck = [[], [1], [], [], [0], [], [3], [], [], [], [], [2]];
    const page = renderPage({
      ...PAGE,
      lines,
      struck,
      grid: true,
      ruleShade: 100,
      wavyStrikes: true,
      skewDegrees: 1.5,
    });
    expect(findStruckWords(page.image, lines)).toEqual(struck);
  });

  it('finds struck words in faint pencil on squared paper', () => {
    const struck = [[2], [], [], [0], [], [], [], [], [4], [], [], []];
    const page = renderPage({ ...PAGE, lines, struck, grid: true, inkShade: 90 });
    expect(findStruckWords(page.image, lines)).toEqual(struck);
  });

  it('ignores the markers of words that are already marked', () => {
    const page = renderPage({ ...PAGE, lines, struck: [[1]] });
    const marked = [lines[0]!.replace(/^(\S+) (\S+)/u, '$1 ~~$2~~'), ...lines.slice(1)];
    expect(findStruckWords(page.image, marked)[0]).toEqual([1]);
  });
});
