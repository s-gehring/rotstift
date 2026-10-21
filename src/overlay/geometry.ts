import type { Bbox, Mark, TranscriptLine } from '../annotations/transcript.ts';
import { readBand, readRows, slopeAt, topAt } from '../layout/band.ts';
import type { LineBand } from '../layout/types.ts';

export interface LineFrame {
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly band: LineBand | null;
  top(x: number): number;
  angle(x: number): number;
}

export type PlacedLine = TranscriptLine & {
  readonly bbox: Bbox;
  readonly frame: LineFrame;
  readonly markIndices: readonly number[];
  readonly start: number;
};

const SNAP_REACH = 12;

export function frameOf(bbox: Bbox): LineFrame {
  const band = readBand(bbox);
  const left = bbox.x;
  const right = bbox.x + bbox.width;
  if (band === null) {
    return { height: bbox.height, left, right, band, top: () => bbox.y, angle: () => 0 };
  }
  return {
    height: band.height,
    left,
    right,
    band,
    top: (x) => topAt(band, x),
    angle: (x) => (Math.atan(slopeAt(band, x)) * 180) / Math.PI,
  };
}

const TREND_SHARE = 0.25;

export function lineTopAt(frame: LineFrame, x: number): number {
  if (x >= frame.left && x <= frame.right) return frame.top(x);
  const edge = x < frame.left ? frame.left : frame.right;
  return frame.top(edge) + trendSlope(frame, x < frame.left ? 'left' : 'right') * (x - edge);
}

export function lineAngleAt(frame: LineFrame, x: number): number {
  if (x >= frame.left && x <= frame.right) return frame.angle(x);
  const slope = trendSlope(frame, x < frame.left ? 'left' : 'right');
  return (Math.atan(slope) * 180) / Math.PI;
}

function trendSlope(frame: LineFrame, side: 'left' | 'right'): number {
  const reach = (frame.right - frame.left) * TREND_SHARE;
  if (frame.band === null || reach <= 0) return 0;
  return side === 'right'
    ? (frame.top(frame.right) - frame.top(frame.right - reach)) / reach
    : (frame.top(frame.left + reach) - frame.top(frame.left)) / reach;
}

export function bendPath(d: string, frame: LineFrame): string {
  if (frame.band === null) return d;
  return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => {
    const px = Number(x);
    const py = Number(y) + frame.top(px);
    return `${Math.round(px * 10) / 10} ${Math.round(py * 10) / 10}`;
  });
}

export function frameLift(frame: LineFrame): number {
  return frame.band === null ? frame.top(frame.left) : 0;
}

function snapToWord(text: string, target: number): number {
  if (target <= 0) return 0;
  if (target >= text.length) return text.length;
  for (let reach = 0; reach <= SNAP_REACH; reach += 1) {
    for (const at of [target - reach, target + reach]) {
      if (at > 0 && at < text.length && text[at - 1] === ' ' && text[at] !== ' ') return at;
    }
  }
  return target;
}

function shifted(mark: Mark, start: number): Mark {
  return { ...mark, offset: mark.offset - start };
}

export function placeLine(line: TranscriptLine & { readonly bbox: Bbox }): PlacedLine[] {
  const rows = readRows(line.bbox);
  const all = line.marks.map((_, index) => index);
  if (rows === null) {
    return [{ ...line, frame: frameOf(line.bbox), markIndices: all, start: 0 }];
  }
  const length = line.text.length;
  const bounds = rows.map((row) => snapToWord(line.text, Math.round(row.from * length)));
  bounds[0] = 0;
  bounds.push(length);
  return rows.map((row, k) => {
    const start = bounds[k] ?? 0;
    const end = Math.max(start, bounds[k + 1] ?? length);
    const last = k === rows.length - 1;
    const inside = all.filter((index) => {
      const offset = line.marks[index]?.offset ?? 0;
      return offset >= start && (offset < end || (last && offset <= end));
    });
    const bbox: Bbox = { x: row.x, y: row.y, width: row.width, height: row.height };
    const box = row.band === undefined ? bbox : { ...bbox, band: row.band };
    return {
      ...line,
      text: line.text.slice(start, end),
      bbox: box,
      marks: inside.flatMap((index) => {
        const mark = line.marks[index];
        return mark === undefined ? [] : [shifted(mark, start)];
      }),
      frame: frameOf(box),
      markIndices: inside,
      start,
    };
  });
}

export function rowFor(placed: readonly PlacedLine[], offset: number): PlacedLine | undefined {
  let found = placed[0];
  for (const row of placed) if (row.start <= offset) found = row;
  return found;
}

export function gapAbove(line: LineFrame, previous: LineFrame | null): number {
  if (previous === null) return line.top(line.left);
  const from = Math.max(line.left, previous.left);
  const to = Math.min(line.right, previous.right);
  if (to <= from) {
    return (
      Math.max(...[line.left, line.right].map((x) => line.top(x))) -
      Math.min(...[previous.left, previous.right].map((x) => previous.top(x) + previous.height))
    );
  }
  let gap = Infinity;
  for (let step = 0; step <= 8; step += 1) {
    const x = from + ((to - from) * step) / 8;
    gap = Math.min(gap, line.top(x) - previous.top(x) - previous.height);
  }
  return gap;
}
