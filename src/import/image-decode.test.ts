import { describe, expect, it } from 'vitest';
import { fitWithin } from './image-decode.ts';

describe('fitWithin', () => {
  it('scales the longest edge down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin({ width: 4000, height: 2000 }, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitWithin({ width: 2000, height: 4000 }, 1000)).toEqual({ width: 500, height: 1000 });
  });

  it('never upscales', () => {
    expect(fitWithin({ width: 300, height: 200 }, 2048)).toEqual({ width: 300, height: 200 });
  });

  it('keeps at least one pixel per edge', () => {
    expect(fitWithin({ width: 10000, height: 1 }, 100)).toEqual({ width: 100, height: 1 });
  });
});
