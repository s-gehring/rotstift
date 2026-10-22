import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import grid from './fixtures/heft-kariert-foto.json';
import { toWorkingGray } from './gray.ts';
import { readJpeg } from './image-files.ts';
import { locateLines } from './locate-lines.ts';
import { findRuling, scaleRuling } from './ruling.ts';
import { iou, renderPage, sampleLines, type PageSpec } from './synthetic.ts';
import type { RuleLine, Ruling } from './types.ts';

const BASE = { width: 1000, height: 1400, pitch: 52, seed: 5 } as const;

function rulingOf(spec: PageSpec): Ruling {
  const page = renderPage(spec);
  const gray = toWorkingGray(page.image);
  return scaleRuling(findRuling(gray, page.image), 1 / gray.scale);
}

function yAt(line: RuleLine, x: number): number {
  const points = line.points;
  let best = points[0] ?? { x: 0, y: 0 };
  for (const point of points) if (Math.abs(point.x - x) < Math.abs(best.x - x)) best = point;
  return best.y;
}

function xAt(line: RuleLine, y: number): number {
  const points = line.points;
  let best = points[0] ?? { x: 0, y: 0 };
  for (const point of points) if (Math.abs(point.y - y) < Math.abs(best.y - y)) best = point;
  return best.x;
}

describe('findRuling', () => {
  it('finds ruled lines with their pitch and position', () => {
    const ruling = rulingOf({ ...BASE, lines: sampleLines(2, 22), ruled: true });
    expect(ruling.kind).toBe('lined');
    expect(ruling.pitch).toBeCloseTo(52, -0.5);
    expect(ruling.vertical).toHaveLength(0);
    expect(ruling.horizontal.length).toBeGreaterThanOrEqual(24);
    const top = 52 * 1.6 + 52 * 0.1;
    for (const line of ruling.horizontal) {
      const offset = (yAt(line, 500) - top) / 52;
      expect(Math.abs(offset - Math.round(offset))).toBeLessThan(0.06);
    }
  });

  it('finds a grid and both of its pitches', () => {
    const ruling = rulingOf({ ...BASE, lines: sampleLines(3, 22), grid: true });
    expect(ruling.kind).toBe('grid');
    expect(ruling.pitch).toBeCloseTo(26, -0.5);
    expect(ruling.columnPitch).toBeCloseTo(26, -0.5);
    expect(ruling.vertical.length).toBeGreaterThanOrEqual(30);
  });

  it('finds the margin of a ruled page', () => {
    const ruling = rulingOf({ ...BASE, lines: sampleLines(4, 22), ruled: true, margin: true });
    expect(ruling.kind).toBe('lined');
    const left = ruling.margins.left;
    const x = left === null ? Number.NaN : xAt(left, 700);
    expect(Math.abs(x - 1000 * 0.13 - 2.5)).toBeLessThan(5);
    expect(ruling.margins.right).toBeNull();
  });

  it('measures the angle of skewed ruling', () => {
    const ruling = rulingOf({ ...BASE, lines: sampleLines(5, 22), ruled: true, skewDegrees: 3 });
    expect(ruling.kind).toBe('lined');
    expect(ruling.angleDegrees).toBeCloseTo(3, 0);
  });

  it('keeps handwriting on plain paper blank', () => {
    const ruling = rulingOf({
      ...BASE,
      lines: sampleLines(6, 24, 34, 44),
      longStrokes: true,
      lineSlopes: 1,
    });
    expect(ruling.kind).toBe('blank');
    expect(ruling.horizontal).toHaveLength(0);
  });

  it('tells ink as light as the ruling apart from the lines', () => {
    const spec: PageSpec = {
      ...BASE,
      lines: sampleLines(7, 22),
      ruled: true,
      ruleShade: 70,
      inkShade: 75,
    };
    const page = renderPage(spec);
    const result = locateLines(page.image, spec.lines);
    expect(result.ruling?.kind).toBe('lined');
    const hits = page.truth.filter((box, index) => {
      const found = result.lines[index];
      return box !== null && found != null && iou(box, found.bbox) >= 0.5;
    }).length;
    expect(hits).toBeGreaterThanOrEqual(page.truth.filter((box) => box !== null).length - 1);
  });
});

describe('locateLines on a rendered photo of grid paper', () => {
  it('finds the grid and every line without a confident miss', () => {
    const image = readJpeg(
      fileURLToPath(new URL('./fixtures/heft-kariert-foto.jpg', import.meta.url)),
    );
    const result = locateLines(
      image,
      grid.lines.map((line) => line.text),
    );
    expect(result.ruling?.kind).toBe('grid');
    let hits = 0;
    let total = 0;
    let wrong = 0;
    grid.lines.forEach((line, index) => {
      if (line.bbox === null) return;
      const [x = 0, y = 0, width = 0, height = 0] = line.bbox;
      const found = result.lines[index];
      total += 1;
      const overlap = found == null ? 0 : iou({ x, y, width, height }, found.bbox);
      if (overlap >= 0.5) hits += 1;
      if (found != null && found.rough !== true && overlap < 0.2) wrong += 1;
    });
    expect(hits).toBeGreaterThanOrEqual(Math.ceil(total * 0.9));
    expect(wrong).toBe(0);
  });
});
