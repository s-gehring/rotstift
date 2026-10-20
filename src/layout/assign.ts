import { item, median } from './signal.ts';
import type { BBox, LineLocation } from './types.ts';

export interface Candidate extends BBox {
  readonly inkCount: number;
}

const MERGE_PENALTY = 0.6;
const SPLIT_PENALTY = 1.0;
const SKIP_TRANSCRIPT_BASE = 1.0;
const SKIP_DETECTED_BASE = 0.25;
const SHORT_LINE_DAMPING = 3;
const MAX_GROUP = 3;
const MIN_CONFIDENCE = 0.2;
const TALL_BAND_RATIO = 1.7;
const GROUP_CONFIDENCE = 0.7;

type Step = { detected: number; transcript: number } | null;

interface Group {
  readonly detected: readonly number[];
  readonly transcript: readonly number[];
}

export function lineLength(text: string): number {
  return Array.from(text.trim().replace(/\s+/gu, ' ')).length;
}

function mismatch(inkChars: number, chars: number): number {
  return Math.abs(Math.log((inkChars + SHORT_LINE_DAMPING) / (chars + SHORT_LINE_DAMPING)));
}

function align(
  widths: readonly number[],
  lengths: readonly number[],
  pixelsPerChar: number,
): Step[][] {
  const n = widths.length;
  const m = lengths.length;
  const typical = Math.max(1, median(lengths));
  const cost: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => Infinity),
  );
  const back: Step[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, (): Step => null),
  );
  item(cost, 0)[0] = 0;

  const widthSum = (from: number, count: number) => {
    let sum = 0;
    for (let k = from; k < from + count; k += 1) sum += widths[k] ?? 0;
    return sum;
  };
  const lengthSum = (from: number, count: number) => {
    let sum = 0;
    for (let k = from; k < from + count; k += 1) sum += lengths[k] ?? 0;
    return sum;
  };

  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      const here = item(cost, i)[j] ?? Infinity;
      if (here === Infinity) continue;
      const relax = (di: number, dj: number, extra: number) => {
        const row = cost[i + di];
        if (row === undefined || j + dj > m) return;
        const candidate = here + extra;
        if (candidate < (row[j + dj] ?? Infinity)) {
          row[j + dj] = candidate;
          item(back, i + di)[j + dj] = { detected: di, transcript: dj };
        }
      };
      if (i < n) {
        const inkChars = (widths[i] ?? 0) / pixelsPerChar;
        relax(1, 0, SKIP_DETECTED_BASE + 0.7 * Math.min(1, inkChars / typical));
      }
      if (j < m) {
        relax(0, 1, SKIP_TRANSCRIPT_BASE + 0.5 * Math.min(1, (lengths[j] ?? 0) / typical));
      }
      if (i < n && j < m) {
        for (let a = 1; a <= MAX_GROUP && i + a <= n; a += 1) {
          relax(
            a,
            1,
            mismatch(widthSum(i, a) / pixelsPerChar, lengths[j] ?? 0) + MERGE_PENALTY * (a - 1),
          );
        }
        for (let b = 2; b <= MAX_GROUP && j + b <= m; b += 1) {
          relax(
            1,
            b,
            mismatch((widths[i] ?? 0) / pixelsPerChar, lengthSum(j, b)) + SPLIT_PENALTY * (b - 1),
          );
        }
      }
    }
  }
  return back;
}

function trace(back: Step[][], n: number, m: number): Group[] {
  const groups: Group[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const step = item(back, i)[j];
    if (step === null || step === undefined) break;
    i -= step.detected;
    j -= step.transcript;
    groups.push({
      detected: Array.from({ length: step.detected }, (_, k) => i + k),
      transcript: Array.from({ length: step.transcript }, (_, k) => j + k),
    });
  }
  return groups.toReversed();
}

function estimateScale(
  widths: readonly number[],
  lengths: readonly number[],
  groups: readonly Group[],
  previous: number,
): number {
  const ratios: number[] = [];
  for (const group of groups) {
    if (group.detected.length !== 1 || group.transcript.length !== 1) continue;
    const length = lengths[item(group.transcript, 0)] ?? 0;
    if (length < 8) continue;
    ratios.push((widths[item(group.detected, 0)] ?? 0) / length);
  }
  return ratios.length >= 1 ? median(ratios) : previous;
}

function union(boxes: readonly BBox[]): BBox {
  const x0 = Math.min(...boxes.map((box) => box.x));
  const y0 = Math.min(...boxes.map((box) => box.y));
  const x1 = Math.max(...boxes.map((box) => box.x + box.width));
  const y1 = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function assignLines(
  candidates: readonly Candidate[],
  transcript: readonly string[],
): (LineLocation | null)[] {
  const result: (LineLocation | null)[] = transcript.map(() => null);
  const indices: number[] = [];
  transcript.forEach((text, index) => {
    if (lineLength(text) > 0) indices.push(index);
  });
  const lengths = indices.map((index) => lineLength(transcript[index] ?? ''));
  const widths = candidates.map((candidate) => candidate.width);
  if (indices.length === 0 || candidates.length === 0) return result;

  let scale = median(widths) / Math.max(1, median(lengths));
  let groups: Group[] = [];
  for (let round = 0; round < 3; round += 1) {
    groups = trace(align(widths, lengths, scale), candidates.length, lengths.length);
    scale = estimateScale(widths, lengths, groups, scale);
  }

  const medianHeight = median(candidates.map((candidate) => candidate.height));
  for (const group of groups) {
    const { detected, transcript: wanted } = group;
    if (detected.length === 0 || wanted.length === 0) continue;
    const boxes = detected.map((index) => item(candidates, index));
    const wantedLengths = wanted.map((index) => item(lengths, index));
    const inkChars = boxes.reduce((sum, box) => sum + box.width, 0) / scale;
    const chars = wantedLengths.reduce((sum, length) => sum + length, 0);
    const grouped = detected.length > 1 || wanted.length > 1;
    const confidence =
      Math.exp(-1.5 * mismatch(inkChars, chars)) * (grouped ? GROUP_CONFIDENCE : 1);
    if (confidence < MIN_CONFIDENCE) continue;

    if (wanted.length === 1) {
      result[item(indices, item(wanted, 0))] = { bbox: union(boxes), confidence };
      continue;
    }
    const box = item(boxes, 0);
    const vertical = wanted.length === 2 && box.height > medianHeight * TALL_BAND_RATIO;
    let consumed = 0;
    wanted.forEach((index, k) => {
      const from = consumed / chars;
      consumed += item(wantedLengths, k);
      const to = consumed / chars;
      const bbox: BBox = vertical
        ? {
            x: box.x,
            y: box.y + box.height * from,
            width: box.width,
            height: box.height * (to - from),
          }
        : {
            x: box.x + box.width * from,
            y: box.y,
            width: box.width * (to - from),
            height: box.height,
          };
      result[item(indices, index)] = { bbox, confidence };
    });
  }
  return result;
}
