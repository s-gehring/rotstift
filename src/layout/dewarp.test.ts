import { describe, expect, it } from 'vitest';
import { analyzeDewarp, applyDewarp, outputSize, planDewarp, toSource } from './dewarp.ts';
import type { DewarpPlan } from './dewarp.ts';
import { homographyFrom, project } from './homography.ts';
import { renderPage, sampleLines } from './synthetic.ts';
import type { Point, RgbaImage } from './types.ts';

const TABLE = [70, 56, 44] as const;

function page(skewDegrees = 0): RgbaImage {
  return renderPage({
    width: 620,
    height: 877,
    pitch: 30,
    lines: sampleLines(7, 20),
    ruled: true,
    margin: true,
    skewDegrees,
  }).image;
}

function photograph(sheet: RgbaImage, corners: readonly Point[], width: number, height: number) {
  const toSheet = homographyFrom(corners, [
    { x: 0, y: 0 },
    { x: sheet.width, y: 0 },
    { x: sheet.width, y: sheet.height },
    { x: 0, y: sheet.height },
  ]);
  if (toSheet === null) throw new Error('corners are degenerate');
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const { x: sx, y: sy } = project(toSheet, { x: x + 0.5, y: y + 0.5 });
      const inside = sx >= 0 && sy >= 0 && sx < sheet.width && sy < sheet.height;
      const from = (Math.floor(sy) * sheet.width + Math.floor(sx)) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[at + channel] = inside ? (sheet.data[from + channel] ?? 0) : (TABLE[channel] ?? 0);
      }
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

function cameraCorners(width: number, height: number): Point[] {
  const tilt = (18 * Math.PI) / 180;
  const pan = (-9 * Math.PI) / 180;
  const roll = (4 * Math.PI) / 180;
  const focal = 1000;
  const corners = [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ] as const;
  return corners.map(([x0, y0]) => {
    const x1 = x0 * Math.cos(roll) - y0 * Math.sin(roll);
    const y1 = x0 * Math.sin(roll) + y0 * Math.cos(roll);
    const y2 = y1 * Math.cos(tilt);
    const z2 = y1 * Math.sin(tilt);
    const x3 = x1 * Math.cos(pan) + z2 * Math.sin(pan);
    const z3 = -x1 * Math.sin(pan) + z2 * Math.cos(pan) + 1150;
    return { x: 400 + (focal * x3) / z3, y: 500 + (focal * y2) / z3 };
  });
}

const CORNERS = cameraCorners(620, 877);

describe('planDewarp', () => {
  it('finds a photographed sheet on a table and maps the output corners onto it', () => {
    const photo = photograph(page(), CORNERS, 800, 1000);
    const plan = planDewarp(photo);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    const size = outputSize(plan, photo);
    const outputCorners = [
      { x: 0, y: 0 },
      { x: size.width, y: 0 },
      { x: size.width, y: size.height },
      { x: 0, y: size.height },
    ];
    outputCorners.forEach((corner, i) => {
      const mapped = toSource(plan, corner, photo);
      const truth = CORNERS[i] ?? { x: 0, y: 0 };
      expect(Math.hypot(mapped.x - truth.x, mapped.y - truth.y)).toBeLessThan(8);
    });
    expect(size.width / size.height).toBeCloseTo(620 / 877, 2);
  });

  it('leaves flat and slightly crooked scans unchanged', () => {
    expect(planDewarp(page())).toBeNull();
    expect(planDewarp(page(0.9))).toBeNull();
    expect(planDewarp(page(-2.5))).toBeNull();
  });

  it('keeps the original when the found edge would cut off writing', () => {
    const shaded = page();
    const data = new Uint8ClampedArray(shaded.data);
    for (let y = 0; y < 330; y += 1) {
      for (let x = 0; x < shaded.width; x += 1) {
        const at = (y * shaded.width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          data[at + channel] = Math.round((data[at + channel] ?? 0) * 0.55);
        }
      }
    }
    const report = analyzeDewarp({ ...shaded, data });
    expect(report.sheet).toBeNull();
    expect(report.plan).toBeNull();
  });
});

describe('applyDewarp', () => {
  const identity: DewarpPlan = {
    width: 1,
    height: 1,
    columns: 2,
    rows: 2,
    mesh: [0, 0, 1, 0, 0, 1, 1, 1],
  };

  it('reproduces the source pixel for pixel under an identity plan', () => {
    const source = page();
    const out = applyDewarp(source, identity);
    expect(out.width).toBe(source.width);
    expect(out.height).toBe(source.height);
    expect(Buffer.from(out.data).equals(Buffer.from(source.data))).toBe(true);
  });

  it('maps output points back through the mesh', () => {
    const shifted: DewarpPlan = { ...identity, width: 0.5, mesh: [0.5, 0, 1, 0, 0.5, 1, 1, 1] };
    expect(toSource(shifted, { x: 0, y: 0 }, { width: 200, height: 100 })).toEqual({
      x: 100,
      y: 0,
    });
    expect(toSource(shifted, { x: 50, y: 50 }, { width: 200, height: 100 })).toEqual({
      x: 150,
      y: 50,
    });
  });
});
