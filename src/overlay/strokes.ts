import { spread, type Random } from './random.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function format(point: Point): string {
  return `${round(point.x)} ${round(point.y)}`;
}

export function smoothPath(points: readonly Point[], closed = false): string {
  const first = points[0];
  if (first === undefined) return '';
  if (points.length < 3) {
    return `M${format(first)}${points
      .slice(1)
      .map((point) => `L${format(point)}`)
      .join('')}`;
  }
  const count = points.length;
  const at = (index: number): Point => {
    const clamped = closed ? (index + count) % count : Math.min(Math.max(index, 0), count - 1);
    return points[clamped] ?? first;
  };
  const segments = closed ? count : count - 1;
  let d = `M${format(first)}`;
  for (let index = 0; index < segments; index += 1) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${format(c1)} ${format(c2)} ${format(p2)}`;
  }
  return d;
}

export function hand(
  x0: number,
  x1: number,
  y: number,
  random: Random,
  wobble: number,
  slope = 0.012,
): string {
  const length = Math.max(x1 - x0, 1);
  const steps = Math.max(2, Math.round(length / Math.max(wobble * 9, 10)));
  const tilt = spread(random, slope) * length;
  const points: Point[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    points.push({
      x: x0 + length * t + (step > 0 && step < steps ? spread(random, length / steps / 6) : 0),
      y: y + tilt * (t - 0.5) + spread(random, wobble),
    });
  }
  return smoothPath(points);
}

export function ring(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  random: Random,
  wobble: number,
): string {
  const steps = 14;
  const start = spread(random, 0.6) - Math.PI * 0.75;
  const sweep = Math.PI * 2 * 1.06;
  const points: Point[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const angle = start + sweep * t;
    const drift = 1 + (t - 0.5) * 0.08;
    points.push({
      x: cx + Math.cos(angle) * rx * drift + spread(random, wobble),
      y: cy + Math.sin(angle) * ry * drift + spread(random, wobble),
    });
  }
  return smoothPath(points);
}

export function caret(
  x: number,
  apexY: number,
  half: number,
  depth: number,
  random: Random,
  wobble: number,
): string {
  const left = { x: x - half + spread(random, wobble), y: apexY + depth + spread(random, wobble) };
  const apex = { x: x + spread(random, wobble), y: apexY + spread(random, wobble) };
  const right = { x: x + half + spread(random, wobble), y: apexY + depth + spread(random, wobble) };
  return `M${format(left)}L${format(apex)}L${format(right)}`;
}
