import { lineLength, splitByLength, type Assignment, type Candidate } from './assign.ts';
import { shiftBand } from './band.ts';
import { item, median } from './signal.ts';
import type { LineBox, LineLocation } from './types.ts';

function shifted(box: LineBox, dy: number): LineBox {
  const y = Math.max(0, box.y + dy);
  const moved = { x: box.x, y, width: box.width, height: box.height };
  return box.band === undefined
    ? moved
    : { ...moved, band: shiftBand(box.band, y - box.y, box.band.height) };
}

function rowPitch(candidates: readonly Candidate[]): number {
  const rows = candidates.map((candidate) => candidate.row).toSorted((a, b) => a - b);
  const gaps: number[] = [];
  for (let k = 1; k < rows.length; k += 1) gaps.push(item(rows, k) - item(rows, k - 1));
  const heights = median(candidates.map((candidate) => candidate.height));
  return gaps.length > 0 ? median(gaps) : heights * 1.4;
}

function rough(bbox: LineBox): LineLocation {
  return { bbox, confidence: 0, rough: true };
}

export function placeRoughly(
  candidates: readonly Candidate[],
  assignment: Assignment,
  transcript: readonly string[],
): (LineLocation | null)[] {
  const lines = [...assignment.lines];
  if (candidates.length === 0) return lines;
  const used = new Set(assignment.sources.flatMap((source) => source ?? []));
  const sources = [...assignment.sources];
  assignment.tentative.forEach((location, index) => {
    const source = assignment.tentativeSources[index] ?? null;
    if (location === null || lines[index] !== null || source === null) return;
    if (source.some((k) => used.has(k))) return;
    lines[index] = rough(location.bbox);
    sources[index] = source;
  });
  for (const source of sources) for (const k of source ?? []) used.add(k);
  const pitch = rowPitch(candidates);
  const rowOf = (index: number) => {
    const source = sources[index];
    if (source === null || source === undefined) return null;
    return source.map((k) => item(candidates, k));
  };

  let previous = -1;
  for (let index = 0; index <= transcript.length; index += 1) {
    const anchored = index < transcript.length && rowOf(index) !== null;
    if (index < transcript.length && !anchored) continue;
    const run = [];
    for (let k = previous + 1; k < index; k += 1) {
      if (lineLength(transcript[k] ?? '') > 0 && lines[k] === null) run.push(k);
    }
    if (run.length > 0) placeRun(run, previous, index < transcript.length ? index : -1);
    previous = index;
  }
  return lines;

  function placeRun(run: readonly number[], before: number, after: number): void {
    const above = before >= 0 ? rowOf(before) : null;
    const below = after >= 0 ? rowOf(after) : null;
    const low = above === null ? -Infinity : Math.max(...above.map((box) => box.row));
    const high = below === null ? Infinity : Math.min(...below.map((box) => box.row));
    const free = candidates
      .map((candidate, k) => ({ candidate, k }))
      .filter(({ candidate, k }) => !used.has(k) && candidate.row > low && candidate.row < high)
      .map(({ candidate }) => candidate);
    if (free.length > 0) {
      const shares = new Map<Candidate, number[]>();
      run.forEach((line, k) => {
        const target = item(free, Math.floor((k * free.length) / run.length));
        shares.set(target, [...(shares.get(target) ?? []), line]);
      });
      for (const [target, sharing] of shares) {
        const parts = splitByLength(
          target,
          sharing.map((line) => lineLength(transcript[line] ?? '')),
        );
        sharing.forEach((line, k) => {
          lines[line] = rough(item(parts, k));
        });
      }
      return;
    }
    const template = item(above ?? below ?? candidates, 0);
    run.forEach((line, k) => {
      let dy: number;
      if (above !== null && below !== null) {
        dy = ((k + 1) * (item(below, 0).row - item(above, 0).row)) / (run.length + 1);
      } else if (above !== null) {
        dy = (k + 1) * pitch;
      } else {
        dy = (k - run.length) * pitch;
      }
      lines[line] = rough(shifted(template, dy));
    });
  }
}
