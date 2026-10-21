import { joinBands, lineLength, type Assignment, type Candidate } from './assign.ts';
import { item, percentile } from './signal.ts';
import type { BBox, LineBox, LineLocation, LineRow } from './types.ts';

const FULL_ROW = 0.75;

export interface Piece {
  readonly line: number;
  readonly from: number;
  readonly to: number;
}

export interface Flow {
  readonly texts: readonly string[];
  readonly pieces: readonly (Piece | null)[];
  readonly split: boolean;
}

function plain(text: string): string {
  return text.replaceAll('~~', '').trim().replace(/\s+/gu, ' ');
}

function cutPoints(text: string, parts: number): number[] {
  const spaces: number[] = [];
  for (let i = 0; i < text.length; i += 1) if (text[i] === ' ') spaces.push(i);
  const cuts: number[] = [];
  for (let k = 1; k < parts; k += 1) {
    const target = (k * text.length) / parts;
    const after = cuts[cuts.length - 1] ?? -1;
    let best = -1;
    for (const space of spaces) {
      if (space <= after) continue;
      if (best < 0 || Math.abs(space - target) < Math.abs(best - target)) best = space;
    }
    if (best >= 0) cuts.push(best);
  }
  return cuts;
}

export function splitLongLines(
  transcript: readonly string[],
  candidates: readonly Candidate[],
): Flow {
  const identity: Flow = {
    texts: transcript,
    pieces: transcript.map((_, line) => ({ line, from: 0, to: 1 })),
    split: false,
  };
  const chars = transcript.reduce((sum, text) => sum + lineLength(text), 0);
  if (candidates.length < 2 || chars === 0) return identity;
  const widths = Float64Array.from(candidates.map((candidate) => candidate.width)).toSorted();
  const perChar = widths.reduce((sum, width) => sum + width, 0) / chars;
  const rowChars = percentile(widths, FULL_ROW) / perChar;
  const texts: string[] = [];
  const pieces: (Piece | null)[] = [];
  transcript.forEach((text, line) => {
    const flat = plain(text);
    const parts = Math.round(flat.length / Math.max(1, rowChars));
    const cuts = parts >= 2 ? cutPoints(flat, parts) : [];
    if (cuts.length === 0) {
      texts.push(text);
      pieces.push(lineLength(text) > 0 ? { line, from: 0, to: 1 } : null);
      return;
    }
    const bounds = [0, ...cuts.map((cut) => cut + 1), flat.length + 1];
    for (let k = 0; k + 1 < bounds.length; k += 1) {
      const start = item(bounds, k);
      const end = item(bounds, k + 1);
      texts.push(flat.slice(start, end - 1));
      pieces.push({
        line,
        from: start / (flat.length + 1),
        to: k + 2 === bounds.length ? 1 : end / (flat.length + 1),
      });
    }
  });
  return texts.length > transcript.length ? { texts, pieces, split: true } : identity;
}

function hull(boxes: readonly BBox[]): BBox {
  const x0 = Math.min(...boxes.map((box) => box.x));
  const y0 = Math.min(...boxes.map((box) => box.y));
  const x1 = Math.max(...boxes.map((box) => box.x + box.width));
  const y1 = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function asRows(box: LineBox, from: number, to: number): LineRow[] {
  if (box.rows === undefined) {
    const { x, y, width, height, band } = box;
    return [
      band === undefined
        ? { x, y, width, height, from, to }
        : { x, y, width, height, band, from, to },
    ];
  }
  return box.rows.map((row) => ({
    ...row,
    from: from + (to - from) * row.from,
    to: from + (to - from) * row.to,
  }));
}

function mergeRows(rows: readonly LineRow[]): LineRow[] {
  const merged: LineRow[] = [];
  for (const row of rows) {
    const last = merged[merged.length - 1];
    const band = last === undefined ? null : joinBands([last, row]);
    if (last === undefined || band === null || row.x < last.x) {
      merged.push(row);
      continue;
    }
    merged[merged.length - 1] = { ...hull([last, row]), band, from: last.from, to: row.to };
  }
  return merged;
}

function rowsOver(boxes: readonly Candidate[]): LineRow[] {
  const total = boxes.reduce((sum, box) => sum + box.width, 0);
  let consumed = 0;
  return boxes.map((box) => {
    const from = consumed / total;
    consumed += box.width;
    const shape = { x: box.x, y: box.y, width: box.width, height: box.height, from };
    const to = consumed / total;
    return box.band === undefined ? { ...shape, to } : { ...shape, band: box.band, to };
  });
}

function boxOf(rows: readonly LineRow[]): LineBox {
  const first = item(rows, 0);
  if (rows.length > 1) return { ...hull(rows), rows };
  return first.band === undefined ? hull([first]) : { ...hull([first]), band: first.band };
}

export function joinPieces(
  flow: Flow,
  assignment: Assignment,
  placed: readonly (LineLocation | null)[],
  candidates: readonly Candidate[],
  count: number,
): (LineLocation | null)[] {
  const owner = new Map<number, number>();
  flow.pieces.forEach((piece, index) => {
    for (const k of assignment.sources[index] ?? []) if (piece !== null) owner.set(k, piece.line);
  });
  const pieceIndices: number[][] = Array.from({ length: count }, () => []);
  flow.pieces.forEach((piece, index) => {
    if (piece !== null) item(pieceIndices, piece.line).push(index);
  });
  const waiting = (after: number, before: number) =>
    flow.pieces.some(
      (piece, index) =>
        index > after &&
        index < before &&
        piece !== null &&
        (assignment.sources[index] ?? null) === null,
    );

  return pieceIndices.map((indices, line) => {
    const located = indices.flatMap((index) => {
      const location = placed[index];
      const piece = flow.pieces[index];
      return location === null || location === undefined || piece === null || piece === undefined
        ? []
        : [{ piece, location }];
    });
    if (located.length === 0) return null;
    const confidence = Math.min(...located.map(({ location }) => location.confidence));
    const sources = indices.flatMap((index) => assignment.sources[index] ?? []);
    if (sources.length === 0) {
      const rows = mergeRows(
        located.flatMap(({ piece, location }) => asRows(location.bbox, piece.from, piece.to)),
      );
      return { bbox: boxOf(rows), confidence, rough: true };
    }
    const low = Math.min(...sources);
    let high = Math.max(...sources);
    const lastPiece = Math.max(...indices);
    const nextPiece = flow.pieces.findIndex(
      (_, index) => index > lastPiece && (assignment.sources[index] ?? null) !== null,
    );
    if (!waiting(lastPiece, nextPiece < 0 ? flow.pieces.length : nextPiece)) {
      while (high + 1 < candidates.length && !owner.has(high + 1)) high += 1;
    }
    const range = candidates
      .slice(low, high + 1)
      .filter((_, k) => (owner.get(low + k) ?? line) === line);
    const rough = located.some(({ location }) => location.rough === true);
    const bbox = boxOf(rowsOver(range));
    return rough ? { bbox, confidence, rough: true } : { bbox, confidence };
  });
}
