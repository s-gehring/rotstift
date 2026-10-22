import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_EDGE, fitWithin, modelImageSize } from './image.ts';

describe('fitWithin', () => {
  it('scales the long edge down and keeps the aspect ratio', () => {
    expect(fitWithin({ width: 2480, height: 3508 })).toEqual({
      width: 1086,
      height: MAX_IMAGE_EDGE,
    });
    expect(fitWithin({ width: 4032, height: 3024 }, 1000)).toEqual({ width: 1000, height: 750 });
  });

  it('never enlarges small images', () => {
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it('keeps at least one pixel per side', () => {
    expect(fitWithin({ width: 10_000, height: 1 })).toEqual({ width: MAX_IMAGE_EDGE, height: 1 });
  });
});

describe('modelImageSize', () => {
  it('enlarges small scans to the target edge and keeps the aspect ratio', () => {
    expect(modelImageSize({ width: 552, height: 601 }, 1152)).toEqual({
      width: 1058,
      height: 1152,
    });
    expect(modelImageSize({ width: 700, height: 500 }, 1152)).toEqual({ width: 1152, height: 823 });
  });

  it('treats images at or above the target edge like fitWithin', () => {
    for (const size of [
      { width: 1152, height: 800 },
      { width: 1240, height: 1754 },
      { width: 4032, height: 3024 },
    ]) {
      expect(modelImageSize(size, 1152)).toEqual(fitWithin(size, 1152));
    }
  });

  it('limits the enlargement factor', () => {
    expect(modelImageSize({ width: 100, height: 50 }, 1152)).toEqual({ width: 400, height: 200 });
    expect(modelImageSize({ width: 1, height: 1 })).toEqual({ width: 4, height: 4 });
  });
});
