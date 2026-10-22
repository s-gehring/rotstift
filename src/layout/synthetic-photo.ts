import { homographyFrom, project } from './homography.ts';
import { renderPage, sampleLines } from './synthetic.ts';
import type { Point, RgbaImage } from './types.ts';

const TABLE = [70, 56, 44] as const;

export function ruledSheet(skewDegrees = 0): RgbaImage {
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

export function photograph(
  sheet: RgbaImage,
  corners: readonly Point[],
  width: number,
  height: number,
): RgbaImage {
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

export function cameraCorners(width: number, height: number): Point[] {
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
