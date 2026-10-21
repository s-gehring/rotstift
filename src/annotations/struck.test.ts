import { describe, expect, it } from 'vitest';
import { markStruck, readStruck, visibleLine, visibleText } from './struck.ts';

describe('readStruck', () => {
  it('removes the markers and keeps the struck text with its position', () => {
    expect(readStruck('Ich ~~gehe~~ ging nach Hause')).toEqual({
      text: 'Ich gehe ging nach Hause',
      struck: [{ offset: 4, text: 'gehe' }],
    });
  });

  it('reads several struck spans and spans with spaces', () => {
    expect(readStruck('~~Am~~ Gestern ~~war es~~ schön')).toEqual({
      text: 'Am Gestern war es schön',
      struck: [
        { offset: 0, text: 'Am' },
        { offset: 11, text: 'war es' },
      ],
    });
  });

  it('leaves lone or empty markers as text', () => {
    expect(readStruck('a ~~ b ~~~~ c~')).toEqual({ text: 'a ~~ b ~~~~ c~', struck: [] });
  });
});

describe('markStruck', () => {
  it('wraps the given words', () => {
    expect(markStruck('Ich gehe ging nach Hause', [1, 4])).toBe('Ich ~~gehe~~ ging nach ~~Hause~~');
  });

  it('keeps words that are already marked', () => {
    expect(markStruck('Ich ~~gehe~~ ging', [1])).toBe('Ich ~~gehe~~ ging');
  });

  it('round-trips with readStruck', () => {
    const marked = markStruck('Er, sie und es.', [0, 2]);
    expect(readStruck(marked)).toEqual({
      text: 'Er, sie und es.',
      struck: [
        { offset: 0, text: 'Er,' },
        { offset: 8, text: 'und' },
      ],
    });
  });
});

describe('visibleLine', () => {
  it('drops struck spans and the space next to them', () => {
    const { text, struck } = readStruck('Ich ~~gehe~~ ging nach Hause');
    const visible = visibleLine(text, struck);
    expect(visible.text).toBe('Ich ging nach Hause');
    expect(visible.positions.slice(0, 5)).toEqual([0, 1, 2, 3, 9]);
  });

  it('handles struck spans at the start and the end', () => {
    const { text, struck } = readStruck('~~Am~~ Morgen ~~früh~~');
    expect(visibleLine(text, struck)).toEqual({
      text: 'Morgen',
      positions: [3, 4, 5, 6, 7, 8],
    });
  });

  it('returns the text unchanged without struck spans', () => {
    expect(visibleText({ text: 'Alles gut.' })).toBe('Alles gut.');
    expect(
      visibleText({ text: 'nur gestrichen', struck: [{ offset: 0, text: 'nur gestrichen' }] }),
    ).toBe('');
  });
});
