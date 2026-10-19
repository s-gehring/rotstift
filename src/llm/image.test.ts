import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_EDGE, fitWithin } from './image.ts';

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
