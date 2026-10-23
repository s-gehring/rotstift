import type { Ruling } from '../layout/types.ts';
import type { MarginPoint, PageMargins } from './model.ts';

function pointsOf(line: Ruling['margins']['left']): readonly MarginPoint[] | null {
  return line === null || line.points.length < 2 ? null : line.points;
}

export function marginsOf(ruling: Ruling | undefined): PageMargins | undefined {
  if (ruling === undefined) return undefined;
  const margins = { left: pointsOf(ruling.margins.left), right: pointsOf(ruling.margins.right) };
  return margins.left === null && margins.right === null ? undefined : margins;
}

export function marginX(points: readonly MarginPoint[], y: number): number {
  const sorted = points.toSorted((a, b) => a.y - b.y);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (y <= first.y) return first.x;
  if (y >= last.y) return last.x;
  for (let i = 1; i < sorted.length; i += 1) {
    const upper = sorted[i];
    const lower = sorted[i - 1];
    if (upper === undefined || lower === undefined || y > upper.y) continue;
    const span = upper.y - lower.y;
    return span <= 0 ? upper.x : lower.x + ((upper.x - lower.x) * (y - lower.y)) / span;
  }
  return last.x;
}
