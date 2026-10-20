import { describe, expect, it } from 'vitest';
import { auc, calibrationBins, calibrationError, separation } from './ocr-calibration.ts';

describe('calibrationBins', () => {
  it('sorts words into half-open bins and keeps 1.0 in the last one', () => {
    const bins = calibrationBins(
      [
        { confidence: 0.2, wrong: true },
        { confidence: 0.5, wrong: true },
        { confidence: 0.6, wrong: false },
        { confidence: 1, wrong: false },
      ],
      [0, 0.5, 0.9, 1],
    );
    expect(bins.map((bin) => [bin.words, bin.wrong])).toEqual([
      [1, 1],
      [2, 1],
      [1, 0],
    ]);
    expect(bins[1]?.meanConfidence).toBeCloseTo(0.55);
  });
});

describe('calibrationError', () => {
  it('is zero when the share of correct words matches the confidence', () => {
    const words = [
      ...Array.from({ length: 3 }, () => ({ confidence: 0.75, wrong: false })),
      { confidence: 0.75, wrong: true },
    ];
    expect(calibrationError(calibrationBins(words, [0, 1]))).toBeCloseTo(0);
  });

  it('is large for a model that is sure about wrong words', () => {
    const words = Array.from({ length: 10 }, (_, index) => ({ confidence: 1, wrong: index < 5 }));
    expect(calibrationError(calibrationBins(words))).toBeCloseTo(0.5);
  });
});

describe('separation', () => {
  it('is 1 when every wrong word is less confident than every right one', () => {
    expect(
      separation([
        { confidence: 0.1, wrong: true },
        { confidence: 0.9, wrong: false },
        { confidence: 0.95, wrong: false },
      ]),
    ).toBe(1);
  });

  it('counts ties as one half', () => {
    expect(auc([0.5], [0.5])).toBe(0.5);
  });
});
