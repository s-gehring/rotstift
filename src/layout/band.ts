import type { BBox, LineBand, LineBox, LineRow, Point } from './types.ts';

export function topAt(band: LineBand, x: number): number {
  const { top } = band;
  const first = top[0];
  if (first === undefined) return 0;
  if (x <= first.x) return first.y;
  for (let i = 1; i < top.length; i += 1) {
    const right = top[i];
    const left = top[i - 1];
    if (right === undefined || left === undefined) break;
    if (x <= right.x) {
      const span = right.x - left.x;
      return span <= 0 ? right.y : left.y + ((right.y - left.y) * (x - left.x)) / span;
    }
  }
  return top[top.length - 1]?.y ?? first.y;
}

export function slopeAt(band: LineBand, x: number): number {
  const { top } = band;
  for (let i = 1; i < top.length; i += 1) {
    const right = top[i];
    const left = top[i - 1];
    if (right === undefined || left === undefined) break;
    if (x <= right.x || i === top.length - 1) {
      const span = right.x - left.x;
      return span <= 0 ? 0 : (right.y - left.y) / span;
    }
  }
  return 0;
}

export function sliceBand(band: LineBand, x0: number, x1: number): LineBand {
  const inside = band.top.filter((point) => point.x > x0 && point.x < x1);
  return {
    top: [{ x: x0, y: topAt(band, x0) }, ...inside, { x: x1, y: topAt(band, x1) }],
    height: band.height,
  };
}

export function shiftBand(band: LineBand, dy: number, height: number): LineBand {
  return { top: band.top.map((point) => ({ x: point.x, y: point.y + dy })), height };
}

export function bandHull(band: LineBand): BBox {
  const xs = band.top.map((point) => point.x);
  const ys = band.top.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) + band.height - y,
  };
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    'y' in value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  );
}

export function readBand(box: BBox | LineBox): LineBand | null {
  if (!('band' in box) || box.band === undefined) return null;
  const { top, height } = box.band;
  if (!Array.isArray(top) || top.length === 0 || !top.every(isPoint)) return null;
  if (!(height > 0)) return null;
  return box.band;
}

function isRow(value: unknown): value is LineRow {
  if (typeof value !== 'object' || value === null) return false;
  if (!('x' in value && 'y' in value && 'width' in value && 'height' in value)) return false;
  if (!('from' in value && 'to' in value)) return false;
  return [value.x, value.y, value.width, value.height, value.from, value.to].every(Number.isFinite);
}

export function readRows(box: BBox | LineBox): readonly LineRow[] | null {
  if (!('rows' in box) || !Array.isArray(box.rows) || box.rows.length < 2) return null;
  return box.rows.every(isRow) ? box.rows : null;
}
