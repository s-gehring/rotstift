import type { Point } from './types.ts';

interface Plane {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

type Side = 'left' | 'right' | 'top' | 'bottom';

const SIDES: readonly Side[] = ['left', 'right', 'top', 'bottom'];
const CLOSE_RADIUS = 2;
const STEP_REACH = 3;
const MIN_STEP = 12;
const BAND = 0.45;
const PER_SCAN = 3;
const MAX_TILT_DEGREES = 25;
const TILT_STEP_DEGREES = 0.5;
const INLIER = 1.5;
const MIN_COVERAGE = 0.25;
const MIN_AREA = 0.3;
const MAX_CORNER_SKEW_DEGREES = 30;
const OUTSIDE = 0.15;
const INK_CONTRAST = 30;
const SHRINK = 0.04;
const GROW = 0.08;
const MIN_OUTSIDE_AREA = 0.015;
const MAX_INK_RATIO = 0.3;

interface EdgePoint {
  readonly along: number;
  readonly across: number;
  readonly sign: 1 | -1;
}

export interface SheetLine {
  readonly offset: number;
  readonly slope: number;
  readonly coverage: number;
}

export interface Sheet {
  readonly corners: readonly [Point, Point, Point, Point];
  readonly found: Readonly<Record<Side, SheetLine | null>>;
}

function runningExtreme(
  plane: Plane,
  data: Uint8Array,
  radius: number,
  horizontal: boolean,
  brightest: boolean,
): Uint8Array {
  const { width, height } = plane;
  const out = new Uint8Array(data.length);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const stride = horizontal ? 1 : width;
  for (let line = 0; line < lines; line += 1) {
    const base = horizontal ? line * width : line;
    for (let i = 0; i < length; i += 1) {
      const to = Math.min(length - 1, i + radius);
      let value = brightest ? 0 : 255;
      for (let k = Math.max(0, i - radius); k <= to; k += 1) {
        const sample = data[base + k * stride] ?? 0;
        if (brightest ? sample > value : sample < value) value = sample;
      }
      out[base + i * stride] = value;
    }
  }
  return out;
}

export function closeDark(plane: Plane, radius = CLOSE_RADIUS): Plane {
  const step = (data: Uint8Array, horizontal: boolean, brightest: boolean) =>
    runningExtreme(plane, data, radius, horizontal, brightest);
  const dilated = step(step(plane.data, true, true), false, true);
  return { ...plane, data: step(step(dilated, true, false), false, false) };
}

function scanLength(plane: Plane, side: Side): { scans: number; depth: number } {
  return side === 'left' || side === 'right'
    ? { scans: plane.height, depth: plane.width }
    : { scans: plane.width, depth: plane.height };
}

function sampleAt(plane: Plane, side: Side, scan: number, depth: number): number {
  const { width, height, data } = plane;
  switch (side) {
    case 'left':
      return data[scan * width + depth] ?? 0;
    case 'right':
      return data[scan * width + (width - 1 - depth)] ?? 0;
    case 'top':
      return data[depth * width + scan] ?? 0;
    case 'bottom':
      return data[(height - 1 - depth) * width + scan] ?? 0;
    default: {
      const unreachable: never = side;
      return unreachable;
    }
  }
}

function edgePoints(plane: Plane, side: Side): EdgePoint[] {
  const { scans, depth } = scanLength(plane, side);
  const limit = Math.floor(depth * BAND);
  const signal = new Float64Array(limit + STEP_REACH + 1);
  const prefix = new Float64Array(signal.length + 1);
  const points: EdgePoint[] = [];
  for (let scan = 1; scan < scans - 1; scan += 1) {
    for (let d = 0; d < signal.length; d += 1) {
      signal[d] =
        (sampleAt(plane, side, scan - 1, d) +
          sampleAt(plane, side, scan, d) +
          sampleAt(plane, side, scan + 1, d)) /
        3;
      prefix[d + 1] = (prefix[d] ?? 0) + (signal[d] ?? 0);
    }
    const step = (d: number) =>
      ((prefix[d + STEP_REACH + 1] ?? 0) -
        (prefix[d + 1] ?? 0) -
        ((prefix[d] ?? 0) - (prefix[d - STEP_REACH] ?? 0))) /
      STEP_REACH;
    const found: { at: number; value: number }[] = [];
    let previous = 0;
    let current = step(STEP_REACH);
    for (let d = STEP_REACH; d < limit; d += 1) {
      const next = step(d + 1);
      const magnitude = Math.abs(current);
      if (magnitude >= MIN_STEP && magnitude >= Math.abs(previous) && magnitude > Math.abs(next)) {
        found.push({ at: d, value: current });
      }
      previous = current;
      current = next;
    }
    found.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    for (const { at, value } of found.slice(0, PER_SCAN)) {
      points.push({ along: scan + 0.5, across: at + 0.5, sign: value > 0 ? 1 : -1 });
    }
  }
  return points;
}

function fitLine(points: readonly EdgePoint[]): { offset: number; slope: number } | null {
  if (points.length < 2) return null;
  let sa = 0;
  let sc = 0;
  let saa = 0;
  let sac = 0;
  for (const { along, across } of points) {
    sa += along;
    sc += across;
    saa += along * along;
    sac += along * across;
  }
  const n = points.length;
  const det = n * saa - sa * sa;
  if (Math.abs(det) < 1e-9) return null;
  const slope = (n * sac - sa * sc) / det;
  return { slope, offset: (sc - slope * sa) / n };
}

function bestLine(points: readonly EdgePoint[], scans: number, depth: number): SheetLine | null {
  const tilts = Math.round(MAX_TILT_DEGREES / TILT_STEP_DEGREES);
  const slopes = Array.from({ length: 2 * tilts + 1 }, (_, i) =>
    Math.tan((((i - tilts) * TILT_STEP_DEGREES) / 180) * Math.PI),
  );
  const reach = Math.ceil(scans * Math.tan((MAX_TILT_DEGREES / 180) * Math.PI));
  const bins = depth + 2 * reach + 1;
  const votes = new Int32Array(2 * slopes.length * bins);
  for (const { along, across, sign } of points) {
    const channel = sign > 0 ? 0 : 1;
    for (let s = 0; s < slopes.length; s += 1) {
      const bin = Math.round(across - (slopes[s] ?? 0) * along) + reach;
      if (bin < 0 || bin >= bins) continue;
      const at = (channel * slopes.length + s) * bins + bin;
      votes[at] = (votes[at] ?? 0) + 1;
    }
  }
  let best = -1;
  let bestVotes = 0;
  for (let at = 0; at < votes.length; at += 1) {
    const count = votes[at] ?? 0;
    if (count > bestVotes) {
      bestVotes = count;
      best = at;
    }
  }
  if (best < 0) return null;
  const channel = Math.floor(best / (slopes.length * bins));
  const slope = slopes[Math.floor(best / bins) % slopes.length] ?? 0;
  const offset = (best % bins) - reach;
  const sign = channel === 0 ? 1 : -1;
  let line: { offset: number; slope: number } | null = { offset, slope };
  let inliers: EdgePoint[] = [];
  for (let round = 0; round < 3 && line !== null; round += 1) {
    const { offset: o, slope: s } = line;
    inliers = points.filter(
      (point) => point.sign === sign && Math.abs(point.across - (o + s * point.along)) <= INLIER,
    );
    line = fitLine(inliers);
  }
  if (line === null) return null;
  const rows = new Set(inliers.map((point) => Math.floor(point.along)));
  return { ...line, coverage: rows.size / scans };
}

function toImageLine(plane: Plane, side: Side, line: SheetLine | null): SheetLine {
  const { width, height } = plane;
  if (line === null) {
    const offset = side === 'right' ? width : side === 'bottom' ? height : 0;
    return { offset, slope: 0, coverage: 0 };
  }
  if (side === 'right') return { ...line, offset: width - line.offset, slope: -line.slope };
  if (side === 'bottom') return { ...line, offset: height - line.offset, slope: -line.slope };
  return line;
}

function intersect(vertical: SheetLine, horizontal: SheetLine): Point {
  const x =
    (vertical.offset + vertical.slope * horizontal.offset) /
    (1 - vertical.slope * horizontal.slope);
  return { x, y: horizontal.offset + horizontal.slope * x };
}

function cornerAngle(previous: Point, corner: Point, next: Point): number {
  const ax = previous.x - corner.x;
  const ay = previous.y - corner.y;
  const bx = next.x - corner.x;
  const by = next.y - corner.y;
  const cos = (ax * bx + ay * by) / Math.max(1e-9, Math.hypot(ax, ay) * Math.hypot(bx, by));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

function polygonArea(corners: readonly Point[]): number {
  let area = 0;
  corners.forEach((corner, i) => {
    const next = corners[(i + 1) % corners.length] ?? corner;
    area += corner.x * next.y - next.x * corner.y;
  });
  return area / 2;
}

function scaled(corners: readonly Point[], factor: number): Point[] {
  const cx = corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length;
  const cy = corners.reduce((sum, corner) => sum + corner.y, 0) / corners.length;
  return corners.map((corner) => ({
    x: cx + (corner.x - cx) * factor,
    y: cy + (corner.y - cy) * factor,
  }));
}

function inside(corners: readonly Point[], x: number, y: number): boolean {
  return corners.every((corner, i) => {
    const next = corners[(i + 1) % corners.length] ?? corner;
    return (next.x - corner.x) * (y - corner.y) - (next.y - corner.y) * (x - corner.x) >= 0;
  });
}

export function inkOutside(plane: Plane, closed: Plane, corners: readonly Point[]) {
  const inner = scaled(corners, 1 - SHRINK);
  const outer = scaled(corners, 1 + GROW);
  let insideCount = 0;
  let insideInk = 0;
  let outsideCount = 0;
  let outsideInk = 0;
  for (let y = 0; y < plane.height; y += 2) {
    for (let x = 0; x < plane.width; x += 2) {
      const at = y * plane.width + x;
      const ink = (closed.data[at] ?? 0) - (plane.data[at] ?? 0) > INK_CONTRAST ? 1 : 0;
      if (inside(inner, x + 0.5, y + 0.5)) {
        insideCount += 1;
        insideInk += ink;
      } else if (!inside(outer, x + 0.5, y + 0.5)) {
        outsideCount += 1;
        outsideInk += ink;
      }
    }
  }
  const total = Math.ceil(plane.width / 2) * Math.ceil(plane.height / 2);
  return {
    inside: insideInk / Math.max(1, insideCount),
    outside: outsideInk / Math.max(1, outsideCount),
    outsideArea: outsideCount / total,
  };
}

export function sheetCandidate(plane: Plane, closed: Plane): Sheet | null {
  const lineAt = (side: Side) => {
    const { scans, depth } = scanLength(closed, side);
    const line = bestLine(edgePoints(closed, side), scans, depth);
    return line !== null && line.coverage >= MIN_COVERAGE ? line : null;
  };
  const found = {
    left: lineAt('left'),
    right: lineAt('right'),
    top: lineAt('top'),
    bottom: lineAt('bottom'),
  };
  if (SIDES.filter((side) => found[side] !== null).length < 3) return null;
  const left = toImageLine(plane, 'left', found.left);
  const right = toImageLine(plane, 'right', found.right);
  const top = toImageLine(plane, 'top', found.top);
  const bottom = toImageLine(plane, 'bottom', found.bottom);
  const corners: [Point, Point, Point, Point] = [
    intersect(left, top),
    intersect(right, top),
    intersect(right, bottom),
    intersect(left, bottom),
  ];
  const { width, height } = plane;
  const outside = corners.some(
    ({ x, y }) =>
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < -OUTSIDE * width ||
      x > (1 + OUTSIDE) * width ||
      y < -OUTSIDE * height ||
      y > (1 + OUTSIDE) * height,
  );
  if (outside) return null;
  if (polygonArea(corners) < MIN_AREA * width * height) return null;
  const skewed = corners.some((corner, i) => {
    const previous = corners[(i + 3) % 4] ?? corner;
    const next = corners[(i + 1) % 4] ?? corner;
    return Math.abs(cornerAngle(previous, corner, next) - 90) > MAX_CORNER_SKEW_DEGREES;
  });
  if (skewed) return null;
  return { corners, found };
}

export function findSheet(plane: Plane): Sheet | null {
  const closed = closeDark(plane);
  const sheet = sheetCandidate(plane, closed);
  if (sheet === null) return null;
  const ink = inkOutside(plane, closed, sheet.corners);
  if (ink.outsideArea < MIN_OUTSIDE_AREA || ink.outside > MAX_INK_RATIO * ink.inside) return null;
  return sheet;
}
