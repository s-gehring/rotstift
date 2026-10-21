import { align, mismatch, type AlignedGroup, type AlignInput } from './align.ts';
import { item, median } from './signal.ts';
import type { BBox, LineLocation } from './types.ts';

export interface Candidate extends BBox {
  readonly inkCount: number;
  readonly row: number;
}

const MIN_MARGINAL = 0.8;
const MIN_GROUP_MARGINAL = 0.7;
const FIT_WEIGHT = 0.5;
const TALL_BAND_RATIO = 1.7;
const GROUP_CONFIDENCE = 0.7;
const SUBSTANTIAL_WIDTH = 0.35;
const SUBSTANTIAL_HEIGHT = 0.5;

export function lineLength(text: string): number {
  return Array.from(text.replaceAll('~~', '').trim().replace(/\s+/gu, ' ')).length;
}

function estimateScale(
  widths: readonly number[],
  lengths: readonly number[],
  groups: readonly AlignedGroup[],
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

function estimatePitch(candidates: readonly Candidate[]): number {
  const heights = median(candidates.map((candidate) => candidate.height));
  const gaps: number[] = [];
  for (let k = 1; k < candidates.length; k += 1) {
    const gap = item(candidates, k).row - item(candidates, k - 1).row;
    if (gap >= heights * 0.4) gaps.push(gap);
  }
  return gaps.length > 0 ? median(gaps) : Math.max(1, heights * 1.2);
}

export function assignLines(
  candidates: readonly Candidate[],
  transcript: readonly string[],
): (LineLocation | null)[] {
  const result: (LineLocation | null)[] = transcript.map(() => null);
  const indices: number[] = [];
  const blanksBefore: number[] = [];
  let blanks = 0;
  transcript.forEach((text, index) => {
    if (lineLength(text) > 0) {
      indices.push(index);
      blanksBefore.push(blanks);
      blanks = 0;
    } else {
      blanks += 1;
    }
  });
  const lengths = indices.map((index) => lineLength(transcript[index] ?? ''));
  const widths = candidates.map((candidate) => candidate.width);
  if (indices.length === 0 || candidates.length === 0) return result;

  const medianWidth = median(widths);
  const medianHeight = median(candidates.map((candidate) => candidate.height));
  const input = (pixelsPerChar: number): AlignInput => ({
    widths,
    rows: candidates.map((candidate) => candidate.row),
    substantial: candidates.map(
      (candidate) =>
        candidate.width >= medianWidth * SUBSTANTIAL_WIDTH &&
        candidate.height >= medianHeight * SUBSTANTIAL_HEIGHT,
    ),
    lengths,
    blanksBefore,
    pitch: estimatePitch(candidates),
    pixelsPerChar,
  });

  let scale = medianWidth / Math.max(1, median(lengths));
  for (let round = 0; round < 2; round += 1) {
    scale = estimateScale(widths, lengths, align(input(scale), false), scale);
  }
  const groups = align(input(scale), true);

  for (const group of groups) {
    const { detected, transcript: wanted } = group;
    if (detected.length === 0 || wanted.length === 0) continue;
    const boxes = detected.map((index) => item(candidates, index));
    const wantedLengths = wanted.map((index) => item(lengths, index));
    const inkChars = boxes.reduce((sum, box) => sum + box.width, 0) / scale;
    const chars = wantedLengths.reduce((sum, length) => sum + length, 0);
    const grouped = detected.length > 1 || wanted.length > 1;
    const confidence =
      group.marginal *
      Math.exp(-FIT_WEIGHT * mismatch(inkChars, chars)) *
      (grouped ? GROUP_CONFIDENCE : 1);
    if (group.marginal < (grouped ? MIN_GROUP_MARGINAL : MIN_MARGINAL)) continue;

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
