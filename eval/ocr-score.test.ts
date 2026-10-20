import { describe, expect, it } from 'vitest';
import { chooseThreshold } from './ocr-score.ts';

describe('chooseThreshold', () => {
  const glmOnScads = [
    { threshold: 0.9, alarms: 37, words: 1951 },
    { threshold: 0.95, alarms: 26, words: 1951 },
    { threshold: 0.98, alarms: 17, words: 1951 },
    { threshold: 0.7, alarms: 65, words: 1951 },
  ];

  it('takes the lowest threshold whose interval reaches 1 false alarm per 100 words', () => {
    expect(chooseThreshold(glmOnScads)).toBe(0.95);
  });

  it('returns undefined when no threshold gets there', () => {
    expect(chooseThreshold([{ threshold: 0.99, alarms: 50, words: 1000 }])).toBeUndefined();
  });

  it('ignores rows without words', () => {
    expect(chooseThreshold([{ threshold: 0.5, alarms: 0, words: 0 }])).toBeUndefined();
  });
});
