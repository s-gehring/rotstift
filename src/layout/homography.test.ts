import { describe, expect, it } from 'vitest';
import {
  homographyFrom,
  project,
  rectangleAspect,
  rotationAbout,
  solveLinear,
} from './homography.ts';

describe('solveLinear', () => {
  it('solves a small system and reports a singular one', () => {
    const [x = 0, y = 0] =
      solveLinear(
        [
          [2, 1],
          [1, 3],
        ],
        [3, 5],
      ) ?? [];
    expect(x).toBeCloseTo(0.8, 12);
    expect(y).toBeCloseTo(1.4, 12);
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
  });
});

describe('homographyFrom', () => {
  it('maps the four source corners onto the target corners', () => {
    const source = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 140 },
      { x: 0, y: 140 },
    ];
    const target = [
      { x: 12, y: 30 },
      { x: 131, y: 18 },
      { x: 140, y: 190 },
      { x: 3, y: 170 },
    ];
    const h = homographyFrom(source, target);
    expect(h).not.toBeNull();
    if (h === null) return;
    source.forEach((point, i) => {
      const mapped = project(h, point);
      expect(mapped.x).toBeCloseTo(target[i]?.x ?? 0, 6);
      expect(mapped.y).toBeCloseTo(target[i]?.y ?? 0, 6);
    });
  });
});

describe('rotationAbout', () => {
  it('keeps the center and turns a point by the angle', () => {
    const h = rotationAbout({ x: 50, y: 50 }, Math.PI / 2);
    expect(project(h, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
    const turned = project(h, { x: 60, y: 50 });
    expect(turned.x).toBeCloseTo(50, 9);
    expect(turned.y).toBeCloseTo(60, 9);
  });
});

describe('rectangleAspect', () => {
  it('recovers aspect ratio and focal length of a photographed rectangle', () => {
    const focal = 1200;
    const tilt = (25 * Math.PI) / 180;
    const pan = (15 * Math.PI) / 180;
    const corners = [
      [-300, -400],
      [300, -400],
      [300, 400],
      [-300, 400],
    ].map(([x = 0, y = 0]) => {
      const depth = y * Math.sin(tilt);
      const z = 1500 - x * Math.sin(pan) + depth * Math.cos(pan);
      const across = x * Math.cos(pan) + depth * Math.sin(pan);
      return { x: 500 + (focal * across) / z, y: 600 + (focal * y * Math.cos(tilt)) / z };
    });
    const [a, b, c, d] = corners;
    if (a === undefined || b === undefined || c === undefined || d === undefined) return;
    const camera = rectangleAspect([a, b, c, d], { x: 500, y: 600 });
    expect(camera?.aspect).toBeCloseTo(0.75, 6);
    expect(camera?.focal).toBeCloseTo(focal, 3);
  });

  it('gives up without perspective', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ] as const;
    expect(rectangleAspect(square, { x: 50, y: 50 })).toBeNull();
  });
});
