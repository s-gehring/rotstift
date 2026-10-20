import { describe, expect, it } from 'vitest';
import { attributeMarks } from './ocr-attribution.ts';

describe('attributeMarks', () => {
  const truth = ['Die Zusammenkunft war gut.'];
  const read = ['Die Lusammenkunft war gut'];
  const attribution = attributeMarks(truth, read);

  it('blames the reading when the marked word was misread', () => {
    const mark = {
      kind: 'error' as const,
      type: 'R',
      original: 'Lusammenkunft',
      correction: 'Lustmonkunft',
      offset: 4,
    };
    expect(attribution.cause(0, mark)).toBe('reading');
  });

  it('blames the corrector when the marked word was read correctly', () => {
    const mark = {
      kind: 'error' as const,
      type: 'R',
      original: 'war',
      correction: 'wahr',
      offset: 18,
    };
    expect(attribution.cause(0, mark)).toBe('corrector');
  });

  it('blames the reading for an omission where the reader dropped a token', () => {
    const mark = {
      kind: 'omission' as const,
      type: 'Z',
      original: '',
      correction: '.',
      offset: 25,
    };
    expect(attribution.cause(0, mark)).toBe('reading');
  });

  it('counts misread words', () => {
    expect([attribution.readWords, attribution.misreadWords]).toEqual([4, 1]);
  });
});

describe('truthAround', () => {
  it('names the true words between the nearest correctly read neighbours', () => {
    const attribution = attributeMarks(
      ['Die Zusammenkunft war gut.'],
      ['Die Lusammenkunft war gut'],
    );
    const mark = {
      kind: 'error' as const,
      type: 'R',
      original: 'Lusammenkunft',
      correction: 'x',
      offset: 4,
    };
    expect(attribution.truthAround(0, mark)).toEqual(['Zusammenkunft']);
  });
});
