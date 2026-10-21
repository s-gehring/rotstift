import { describe, expect, it } from 'vitest';
import { bandHull, readBand, readRows, shiftBand, sliceBand, slopeAt, topAt } from './band.ts';
import type { LineBand } from './types.ts';

const band: LineBand = {
  top: [
    { x: 100, y: 200 },
    { x: 300, y: 210 },
    { x: 500, y: 200 },
  ],
  height: 40,
};

describe('line bands', () => {
  it('interpolates the top edge and keeps it level beyond the ends', () => {
    expect(topAt(band, 200)).toBe(205);
    expect(topAt(band, 400)).toBe(205);
    expect(topAt(band, 0)).toBe(200);
    expect(topAt(band, 900)).toBe(200);
    expect(slopeAt(band, 150)).toBeCloseTo(0.05);
    expect(slopeAt(band, 450)).toBeCloseTo(-0.05);
  });

  it('slices, shifts and wraps a band in its hull', () => {
    const slice = sliceBand(band, 200, 400);
    expect(slice.top).toEqual([
      { x: 200, y: 205 },
      { x: 300, y: 210 },
      { x: 400, y: 205 },
    ]);
    expect(bandHull(slice)).toEqual({ x: 200, y: 205, width: 200, height: 45 });
    expect(shiftBand(band, 10, 20).top[1]).toEqual({ x: 300, y: 220 });
  });

  it('reads only well-formed bands and rows from a box', () => {
    const box = { x: 100, y: 200, width: 400, height: 50 };
    expect(readBand(box)).toBeNull();
    expect(readBand({ ...box, band })).toBe(band);
    expect(readBand({ ...box, band: { top: [], height: 40 } })).toBeNull();
    const rows = [
      { ...box, from: 0, to: 0.5 },
      { ...box, y: 260, from: 0.5, to: 1 },
    ];
    expect(readRows({ ...box, rows })).toBe(rows);
    expect(readRows({ ...box, rows: rows.slice(0, 1) })).toBeNull();
  });
});
