import { align, mismatch, type AlignedGroup, type AlignInput } from './align.ts';
import { bandHull, shiftBand, sliceBand, topAt } from './band.ts';
import { item, median } from './signal.ts';
import type { BBox, LineBand, LineBox, LineLocation, LineRow } from './types.ts';

export interface Candidate extends LineBox {
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

function union(boxes: readonly LineBox[]): LineBox {
  const x0 = Math.min(...boxes.map((box) => box.x));
  const y0 = Math.min(...boxes.map((box) => box.y));
  const x1 = Math.max(...boxes.map((box) => box.x + box.width));
  const y1 = Math.max(...boxes.map((box) => box.y + box.height));
  const hull: BBox = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  if (boxes.length === 1 || sideBySide(boxes)) {
    const band = joinBands(boxes);
    return band === null ? hull : { ...hull, band };
  }
  return { ...hull, rows: stackRows(boxes) };
}

export function stackRows(boxes: readonly LineBox[]): LineRow[] {
  const total = boxes.reduce((sum, box) => sum + box.width, 0);
  let consumed = 0;
  return boxes.map((box) => {
    const from = total > 0 ? consumed / total : 0;
    consumed += box.width;
    return { ...rowShape(box), from, to: total > 0 ? consumed / total : 1 };
  });
}

function rowShape(box: LineBox): BBox & { band?: LineBand } {
  const shape = { x: box.x, y: box.y, width: box.width, height: box.height };
  return box.band === undefined ? shape : { ...shape, band: box.band };
}

function bandHeight(box: LineBox): number {
  return box.band?.height ?? box.height;
}

export function splitByLength(box: LineBox, lengths: readonly number[]): LineBox[] {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let consumed = 0;
  return lengths.map((length) => {
    const from = total > 0 ? consumed / total : 0;
    consumed += length;
    return splitBox(box, from, total > 0 ? consumed / total : 1, false);
  });
}

function centerAt(box: LineBox, x: number): number {
  return box.band === undefined ? box.y + box.height / 2 : topAt(box.band, x) + box.band.height / 2;
}

function sideBySide(boxes: readonly LineBox[]): boolean {
  const ordered = boxes.toSorted((a, b) => a.x - b.x);
  for (let k = 1; k < ordered.length; k += 1) {
    const left = item(ordered, k - 1);
    const right = item(ordered, k);
    const edge = left.x + left.width;
    if (right.x < edge - right.width * 0.2) return false;
    const height = Math.max(left.band?.height ?? left.height, right.band?.height ?? right.height);
    if (Math.abs(centerAt(right, right.x) - centerAt(left, edge)) > height * 0.6) return false;
  }
  return true;
}

export function joinBands(boxes: readonly LineBox[]): LineBand | null {
  if (boxes.length === 1) return boxes[0]?.band ?? null;
  if (!sideBySide(boxes)) return null;
  const top: LineBand['top'][number][] = [];
  let height = 0;
  for (const box of boxes.toSorted((a, b) => a.x - b.x)) {
    if (box.band === undefined) return null;
    top.push(...box.band.top);
    height = Math.max(height, box.band.height);
  }
  return { top, height };
}

function splitBox(box: LineBox, from: number, to: number, vertical: boolean): LineBox {
  if (vertical) {
    const hull = {
      x: box.x,
      y: box.y + box.height * from,
      width: box.width,
      height: box.height * (to - from),
    };
    if (box.band === undefined) return hull;
    const height = box.band.height;
    return { ...hull, band: shiftBand(box.band, height * from, height * (to - from)) };
  }
  const x0 = box.x + box.width * from;
  const x1 = box.x + box.width * to;
  if (box.band === undefined) return { x: x0, y: box.y, width: x1 - x0, height: box.height };
  const band = sliceBand(box.band, x0, x1);
  return { ...bandHull(band), band };
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

export interface Assignment {
  readonly lines: (LineLocation | null)[];
  readonly sources: (readonly number[] | null)[];
  readonly tentative: (LineLocation | null)[];
  readonly tentativeSources: (readonly number[] | null)[];
}

export function assignLines(
  candidates: readonly Candidate[],
  transcript: readonly string[],
): (LineLocation | null)[] {
  return assignWithSources(candidates, transcript).lines;
}

export function assignWithSources(
  candidates: readonly Candidate[],
  transcript: readonly string[],
): Assignment {
  const result: (LineLocation | null)[] = transcript.map(() => null);
  const sources: (readonly number[] | null)[] = transcript.map(() => null);
  const tentative: (LineLocation | null)[] = transcript.map(() => null);
  const tentativeSources: (readonly number[] | null)[] = transcript.map(() => null);
  const done = { lines: result, sources, tentative, tentativeSources };
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
  if (indices.length === 0 || candidates.length === 0) return done;

  const medianWidth = median(widths);
  const medianHeight = median(candidates.map((candidate) => candidate.height));
  const medianBand = median(candidates.map(bandHeight));
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
    const sure = group.marginal >= (grouped ? MIN_GROUP_MARGINAL : MIN_MARGINAL);
    const target = sure ? result : tentative;
    for (const index of wanted)
      (sure ? sources : tentativeSources)[item(indices, index)] = detected;
    if (wanted.length === 1) {
      target[item(indices, item(wanted, 0))] = { bbox: union(boxes), confidence };
      continue;
    }
    const box = item(boxes, 0);
    const vertical = wanted.length === 2 && bandHeight(box) > medianBand * TALL_BAND_RATIO;
    let consumed = 0;
    wanted.forEach((index, k) => {
      const from = consumed / chars;
      consumed += item(wantedLengths, k);
      const to = consumed / chars;
      target[item(indices, index)] = { bbox: splitBox(box, from, to, vertical), confidence };
    });
  }
  return done;
}
