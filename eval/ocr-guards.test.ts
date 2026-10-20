import { describe, expect, it } from 'vitest';
import { judgeMark } from './ocr-guards.ts';

const mark = {
  kind: 'error' as const,
  type: 'R',
  original: 'Lusammenkunft',
  correction: 'Lustmonkunft',
  offset: 0,
};
const known = new Set(['Zusammenkunft']);
const isWord = (word: string) => known.has(word);

describe('judgeMark', () => {
  it('drops corrections that are no word', () => {
    expect(judgeMark(mark, { line: 'Lusammenkunft' }, { isWord })).toBe('drop');
    expect(
      judgeMark({ ...mark, correction: 'Zusammenkunft' }, { line: 'Lusammenkunft' }, { isWord }),
    ).toBe('keep');
  });

  it('turns marks on uncertainly read words into hints', () => {
    const probabilities = Array.from('Lusammenkunft', (_, index) => (index === 0 ? 0.4 : 1));
    const context = { line: 'Lusammenkunft', probabilities };
    expect(judgeMark(mark, context, { minConfidence: 0.5 })).toBe('uncertain');
    expect(judgeMark(mark, context, { minConfidence: 0.3 })).toBe('keep');
  });
});
