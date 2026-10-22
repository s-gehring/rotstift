import { item, median } from './signal.ts';
import type { BBox, LineLocation, RuleLine, Ruling } from './types.ts';

const MIN_LINES = 4;
const MAX_ROW_HEIGHT = 2.5;
const MIN_INK = 0.4;
const MAX_SHIFT = 0.25;
const SHIFTED_HEIGHT = 0.75;

interface Plausibility {
  readonly tall: boolean;
  readonly empty: boolean;
  readonly shifted: boolean;
}

function yAt(line: RuleLine, x: number): number {
  const points = line.points;
  const first = item(points, 0);
  if (x <= first.x) return first.y;
  for (let k = 1; k < points.length; k += 1) {
    const right = item(points, k);
    if (x <= right.x) {
      const left = item(points, k - 1);
      const length = right.x - left.x;
      return length > 0 ? left.y + ((right.y - left.y) * (x - left.x)) / length : right.y;
    }
  }
  return item(points, points.length - 1).y;
}

function phaseOf(ruling: Ruling, box: BBox): number | null {
  if (ruling.horizontal.length === 0 || !(ruling.pitch > 0)) return null;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  let nearest = Infinity;
  for (const line of ruling.horizontal) {
    const offset = y - yAt(line, x);
    if (Math.abs(offset) < Math.abs(nearest)) nearest = offset;
  }
  return Number.isFinite(nearest) ? nearest / ruling.pitch : null;
}

function circularDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % 1;
  return Math.min(difference, 1 - difference);
}

function circularMedian(values: readonly number[]): number {
  let best = item(values, 0);
  let bestCost = Infinity;
  for (const candidate of values) {
    const cost = values.reduce((sum, value) => sum + circularDistance(candidate, value), 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
}

function rowHeight(box: LineLocation['bbox']): number {
  return box.height / Math.max(1, box.rows?.length ?? 1);
}

function judgeLines(
  lines: readonly (LineLocation | null)[],
  ruling: Ruling,
  inkShare: (box: BBox) => number,
): (Plausibility | null)[] {
  const sure = lines.filter((line): line is LineLocation => line !== null && line.rough !== true);
  if (sure.length < MIN_LINES) return lines.map(() => null);
  const height = median(sure.map((line) => rowHeight(line.bbox)));
  const ink = median(sure.map((line) => inkShare(line.bbox)));
  const phases =
    ruling.kind === 'lined'
      ? sure.flatMap((line) => {
          const phase = phaseOf(ruling, line.bbox);
          return phase === null ? [] : [phase];
        })
      : [];
  const typical = phases.length >= MIN_LINES ? circularMedian(phases) : null;
  return lines.map((line) => {
    if (line === null || line.rough === true) return null;
    const relative = rowHeight(line.bbox) / height;
    const phase = typical === null ? null : phaseOf(ruling, line.bbox);
    return {
      tall: relative > MAX_ROW_HEIGHT,
      empty: inkShare(line.bbox) < ink * MIN_INK,
      shifted:
        phase !== null &&
        typical !== null &&
        circularDistance(phase, typical) > MAX_SHIFT &&
        relative < SHIFTED_HEIGHT,
    };
  });
}

export function markImplausible(
  lines: readonly (LineLocation | null)[],
  ruling: Ruling,
  inkShare: (box: BBox) => number,
): (LineLocation | null)[] {
  const verdicts = judgeLines(lines, ruling, inkShare);
  return lines.map((line, index) => {
    const verdict = verdicts[index];
    if (line === null || verdict == null) return line;
    if (!verdict.tall && !verdict.empty && !verdict.shifted) return line;
    return { bbox: line.bbox, confidence: 0, rough: true };
  });
}
