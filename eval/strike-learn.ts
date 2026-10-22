import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  applyDewarp,
  outputSize,
  planDewarp,
  toSource,
  type DewarpPlan,
} from '../src/layout/dewarp.ts';
import { readJpeg } from '../src/layout/image-files.ts';
import { locateLines } from '../src/layout/locate-lines.ts';
import { STROKE_FEATURES, strikeCandidates, type StrokeFeatures } from '../src/layout/strike.ts';
import type { BBox, Point } from '../src/layout/types.ts';
import { parseTranscript } from '../src/pipeline/transcript-lines.ts';
import type { OcrRun } from './ocr-run.ts';
import { canonicalStrikes, idealRun } from './strike.ts';
import { tokens } from './strike-score.ts';

const coreRatios: number[] = [];
const POSITIVE = 0.6;
const NEGATIVE = 0.2;
const SLACK = 0.5;

interface Sample {
  readonly page: string;
  readonly set: number;
  readonly label: 0 | 1;
  readonly features: StrokeFeatures;
}

interface StrikeTruth {
  readonly width: number;
  readonly boxes: readonly (readonly [number, number, number, number])[];
}

export function inverse(plan: DewarpPlan, source: { width: number; height: number }) {
  const size = outputSize(plan, source);
  const step = 8;
  const grid: { out: Point; at: Point }[] = [];
  for (let y = 0; y <= size.height; y += step) {
    for (let x = 0; x <= size.width; x += step) {
      grid.push({ out: { x, y }, at: toSource(plan, { x, y }, source) });
    }
  }
  return (point: Point): Point => {
    let best = grid[0] ?? { out: point, at: point };
    let distance = Infinity;
    for (const cell of grid) {
      const d = (cell.at.x - point.x) ** 2 + (cell.at.y - point.y) ** 2;
      if (d < distance) {
        distance = d;
        best = cell;
      }
    }
    let guess = best.out;
    for (let round = 0; round < 6; round += 1) {
      const here = toSource(plan, guess, source);
      const dx = toSource(plan, { x: guess.x + 1, y: guess.y }, source);
      const dy = toSource(plan, { x: guess.x, y: guess.y + 1 }, source);
      const a = dx.x - here.x;
      const b = dy.x - here.x;
      const c = dx.y - here.y;
      const d = dy.y - here.y;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-9) break;
      const ex = point.x - here.x;
      const ey = point.y - here.y;
      guess = { x: guess.x + (d * ex - b * ey) / det, y: guess.y + (-c * ex + a * ey) / det };
    }
    return guess;
  };
}

function collect(
  run: OcrRun,
  set: number,
  imageDir: string,
  truthDir: string,
  dewarp: boolean,
  only: string | undefined,
): { samples: Sample[]; boxes: number; covered: number } {
  const samples: Sample[] = [];
  let boxes = 0;
  let covered = 0;
  for (const page of run.pages) {
    if (only !== undefined && !page.name.endsWith(only)) continue;
    const strikeFile = join(truthDir, `${page.name}.strikes.json`);
    const imagePath = join(imageDir, `${page.name}.jpg`);
    if (!existsSync(strikeFile) || !existsSync(imagePath)) continue;
    const truth: StrikeTruth = JSON.parse(readFileSync(strikeFile, 'utf8'));
    const lines = parseTranscript(canonicalStrikes(page.content).replace(/~~/gu, '')).lines.map(
      (line) =>
        tokens(line)
          .map((token) => token.word)
          .join(' '),
    );
    const original = readJpeg(imagePath);
    const plan = dewarp ? planDewarp(original) : null;
    const image = plan === null ? original : applyDewarp(original, plan);
    const toImage = plan === null ? (point: Point) => point : inverse(plan, original);
    const factor = original.width / truth.width;
    const layout = locateLines(image, lines);
    const parts = layout.lines.flatMap((line): BBox[] => {
      if (line === null || line.rough === true) return [];
      return line.bbox.rows === undefined ? [line.bbox] : [...line.bbox.rows];
    });
    const found = strikeCandidates(image, parts, layout.ruling);
    const targets = truth.boxes.map(([x0, y0, x1, y1]) => {
      const corners = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x0, y: y1 },
        { x: x1, y: y1 },
      ].map((corner) => toImage({ x: corner.x * factor, y: corner.y * factor }));
      const xs = corners.map((corner) => corner.x * found.scale);
      const ys = corners.map((corner) => corner.y * found.scale);
      const height = Math.max(...ys) - Math.min(...ys);
      return {
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(...ys) - SLACK * height,
        y1: Math.max(...ys) + SLACK * height,
      };
    });
    for (const target of targets) {
      const height = (target.y1 - target.y0) / (1 + 2 * SLACK);
      const line = found.lines.find(
        (candidate) =>
          candidate !== null &&
          candidate.band.x0 <= target.x0 &&
          candidate.band.x1 >= target.x1 &&
          candidate.band.y0 <= target.y1 &&
          candidate.band.y1 >= target.y0,
      );
      if (line) coreRatios.push((line.core.bottom - line.core.top) / height);
    }
    const hit = new Set<number>();
    for (const line of found.lines) {
      for (const stroke of line?.found ?? []) {
        let best = 0;
        let owner = -1;
        targets.forEach((target, index) => {
          const inside = stroke.ys.filter((y, k) => {
            const x = stroke.x0 + k;
            return x >= target.x0 && x <= target.x1 && y >= target.y0 && y <= target.y1;
          }).length;
          const share = inside / stroke.ys.length;
          if (share > best) {
            best = share;
            owner = index;
          }
        });
        if (best >= POSITIVE) hit.add(owner);
        if (best >= POSITIVE || best <= NEGATIVE) {
          samples.push({
            page: page.name,
            set,
            label: best >= POSITIVE ? 1 : 0,
            features: stroke.features,
          });
        }
      }
    }
    boxes += targets.length;
    covered += hit.size;
  }
  return { samples, boxes, covered };
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i] ?? 0]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(a[row]?.[column] ?? 0) > Math.abs(a[pivot]?.[column] ?? 0)) pivot = row;
    }
    [a[column], a[pivot]] = [a[pivot] ?? [], a[column] ?? []];
    const head = a[column] ?? [];
    const lead = head[column] ?? 1;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const target = a[row] ?? [];
      const factor = (target[column] ?? 0) / lead;
      for (let k = column; k <= n; k += 1) target[k] = (target[k] ?? 0) - factor * (head[k] ?? 0);
    }
  }
  return a.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
}

function fitLogistic(samples: readonly Sample[], ridge: number): Record<string, number> {
  const rows = samples.map((sample) => [1, ...STROKE_FEATURES.map((key) => sample.features[key])]);
  const labels = samples.map((sample) => sample.label);
  let beta = Array.from({ length: STROKE_FEATURES.length + 1 }, () => 0);
  for (let round = 0; round < 50; round += 1) {
    const hessian = beta.map((_, i) => beta.map((__, j) => (i === j && i > 0 ? ridge : 0)));
    const gradient = beta.map((value, i) => (i > 0 ? -ridge * value : 0));
    rows.forEach((row, index) => {
      const label = labels[index] ?? 0;
      const p = sigmoid(row.reduce((sum, value, k) => sum + value * (beta[k] ?? 0), 0));
      for (let i = 0; i < row.length; i += 1) {
        gradient[i] = (gradient[i] ?? 0) + (label - p) * (row[i] ?? 0);
        const hi = hessian[i] ?? [];
        for (let j = 0; j < row.length; j += 1) {
          hi[j] = (hi[j] ?? 0) + p * (1 - p) * (row[i] ?? 0) * (row[j] ?? 0);
        }
      }
    });
    const step = solve(hessian, gradient);
    beta = beta.map((value, i) => value + (step[i] ?? 0));
    if (step.every((value) => Math.abs(value) < 1e-6)) break;
  }
  return Object.fromEntries([
    ['bias', beta[0] ?? 0],
    ...STROKE_FEATURES.map((key, i) => [key, beta[i + 1] ?? 0]),
  ]);
}

function main() {
  const { values } = parseArgs({
    options: {
      ocr: { type: 'string', multiple: true },
      ideal: { type: 'boolean', default: false },
      images: { type: 'string', multiple: true },
      truth: { type: 'string', multiple: true },
      lines: { type: 'string', multiple: true },
      dewarp: { type: 'boolean', default: false },
      dump: { type: 'string' },
      fit: { type: 'string', multiple: true },
      ridge: { type: 'string', default: '1' },
      only: { type: 'string' },
    },
  });
  if (values.fit !== undefined) {
    const samples: Sample[] = values.fit.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')));
    const weights = fitLogistic(samples, Number(values.ridge));
    console.log(
      `${samples.length} Kandidaten, davon ${samples.filter((sample) => sample.label === 1).length} Striche`,
    );
    console.log(
      JSON.stringify(
        Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Number(v.toFixed(2))])),
      ),
    );
    return;
  }
  const sets = values.ideal ? (values.images?.length ?? 0) : (values.ocr?.length ?? 0);
  if (!values.truth || sets === 0 || sets !== values.truth.length || !values.dump)
    throw new Error('--ocr (oder --ideal mit --images), --truth paarweise und --dump angeben');
  const samples: Sample[] = [];
  let boxes = 0;
  let covered = 0;
  for (let set = 0; set < sets; set += 1) {
    const imageDir = values.images?.[set] ?? '';
    const truthDir = values.truth[set] ?? '';
    const run: OcrRun = values.ideal
      ? idealRun(imageDir, truthDir, values.lines?.[set])
      : JSON.parse(readFileSync(values.ocr?.[set] ?? '', 'utf8'));
    const result = collect(run, set, imageDir, truthDir, values.dewarp, values.only);
    samples.push(...result.samples);
    boxes += result.boxes;
    covered += result.covered;
  }
  writeFileSync(values.dump, JSON.stringify(samples));
  const ratios = coreRatios.toSorted((a, b) => a - b);
  const at = (share: number) => (ratios[Math.floor(ratios.length * share)] ?? 0).toFixed(2);
  console.log(`Kernzone/x-Höhe: p10 ${at(0.1)}, Median ${at(0.5)}, p90 ${at(0.9)}`);
  console.log(
    `Striche ${boxes}, mit Kandidat ${covered} (${((100 * covered) / Math.max(1, boxes)).toFixed(1)} %), Kandidaten ${samples.length}`,
  );
}

if (import.meta.main) main();
