import type { Point } from './types.ts';

export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export function solveLinear(matrix: readonly number[][], rhs: readonly number[]): number[] | null {
  const n = rhs.length;
  const rows = matrix.map((row, i) => [...row, rhs[i] ?? 0]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(rows[row]?.[column] ?? 0) > Math.abs(rows[pivot]?.[column] ?? 0)) pivot = row;
    }
    const top = rows[pivot];
    const current = rows[column];
    if (top === undefined || current === undefined) return null;
    const lead = top[column] ?? 0;
    if (Math.abs(lead) < 1e-12) return null;
    rows[pivot] = current;
    rows[column] = top;
    for (let row = 0; row < n; row += 1) {
      const target = rows[row];
      if (row === column || target === undefined) continue;
      const factor = (target[column] ?? 0) / lead;
      if (factor === 0) continue;
      for (let k = column; k <= n; k += 1) target[k] = (target[k] ?? 0) - factor * (top[k] ?? 0);
    }
  }
  return rows.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
}

export function homographyFrom(
  source: readonly Point[],
  target: readonly Point[],
): Homography | null {
  const matrix: number[][] = [];
  const rhs: number[] = [];
  source.forEach(({ x, y }, i) => {
    const { x: u, y: v } = target[i] ?? { x: 0, y: 0 };
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  });
  const h = solveLinear(matrix, rhs);
  if (h === null) return null;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, k = 0] = h;
  return [a, b, c, d, e, f, g, k, 1];
}

export function project(h: Homography, { x, y }: Point): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

export function rotationAbout(center: Point, radians: number): Homography {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    cos,
    -sin,
    center.x - cos * center.x + sin * center.y,
    sin,
    cos,
    center.y - sin * center.x - cos * center.y,
    0,
    0,
    1,
  ];
}

type Vector = readonly [number, number, number];

function cross(a: Vector, b: Vector): Vector {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vector, b: Vector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function rectangleAspect(
  corners: readonly [Point, Point, Point, Point],
  center: Point,
): { aspect: number; focal: number } | null {
  const [tl, tr, br, bl] = corners;
  const m1: Vector = [tl.x, tl.y, 1];
  const m2: Vector = [tr.x, tr.y, 1];
  const m3: Vector = [bl.x, bl.y, 1];
  const m4: Vector = [br.x, br.y, 1];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2: Vector = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1];
  const n3: Vector = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
  const { x: u, y: v } = center;
  const depth = n2[2] * n3[2];
  const focal2 =
    -(
      n2[0] * n3[0] -
      (n2[0] * n3[2] + n2[2] * n3[0]) * u +
      depth * u * u +
      (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v + depth * v * v)
    ) / depth;
  if (!Number.isFinite(focal2) || focal2 <= 0) return null;
  const norm = (n: Vector) =>
    ((n[0] - u * n[2]) ** 2 + (n[1] - v * n[2]) ** 2) / focal2 + n[2] ** 2;
  const aspect = Math.sqrt(norm(n2) / norm(n3));
  return Number.isFinite(aspect) ? { aspect, focal: Math.sqrt(focal2) } : null;
}
