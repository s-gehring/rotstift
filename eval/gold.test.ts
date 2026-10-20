import { describe, expect, it } from 'vitest';
import { goldFromMarkup, transcriptFromText, wrapMarkup } from './gold.ts';

describe('wrapMarkup', () => {
  it('breaks at word boundaries and never inside an error span', () => {
    const lines = wrapMarkup('Wir gehen {zum essen|zum Essen|R} und trinken Tee', 12);
    expect(lines).toEqual(['Wir gehen', '{zum essen|zum Essen|R}', 'und trinken', 'Tee']);
  });

  it('keeps a missing mark attached to the preceding word', () => {
    expect(wrapMarkup('Ich glaube{|,|Z} dass er kommt', 40)).toEqual([
      'Ich glaube{|,|Z} dass er kommt',
    ]);
  });

  it('starts a new line for every paragraph', () => {
    expect(wrapMarkup('Titel\n\nText hier', 40)).toEqual(['Titel', 'Text hier']);
  });
});

describe('goldFromMarkup', () => {
  const { input, gold, corrected } = goldFromMarkup(
    'Ich glaube{|,|Z} dass der {Hunt|Hund|R} bellt.',
    80,
  );

  it('derives the written text without marks as input', () => {
    expect(input.lines).toEqual([
      { number: 1, text: 'Ich glaube dass der Hunt bellt.', marks: [] },
    ]);
  });

  it('derives gold marks with offsets in the written text', () => {
    expect(gold.lines[0]?.marks).toEqual([
      { kind: 'omission', type: 'Z', original: '', correction: ',', offset: 10 },
      { kind: 'error', type: 'R', original: 'Hunt', correction: 'Hund', offset: 20 },
    ]);
  });

  it('derives the corrected text', () => {
    expect(corrected).toBe('Ich glaube, dass der Hund bellt.');
  });
});

describe('transcriptFromText', () => {
  it('wraps plain text into numbered lines', () => {
    const transcript = transcriptFromText('eins zwei drei vier', 9);
    expect(transcript.lines.map((line) => line.text)).toEqual(['eins zwei', 'drei vier']);
    expect(transcript.lines.map((line) => line.number)).toEqual([1, 2]);
  });
});
