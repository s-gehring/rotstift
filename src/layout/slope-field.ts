import { solveLinear } from './homography.ts';
import type { Point } from './types.ts';

export interface SlopeSample {
  readonly x: number;
  readonly y: number;
  readonly slope: number;
  readonly weight: number;
}

export interface SlopeModel {
  readonly slopeAt: (x: number, y: number) => number;
  readonly samples: number;
  readonly spread: number;
  readonly top: number;
  readonly bottom: number;
}

const KNOTS = 9;
const ROUGHNESS = 2;
const RIDGE = 1e-3;
const ROUNDS = 4;
const MIN_SAMPLES = 24;
const HUBER = 2.5;

export function slopesFromLines(lines: readonly { readonly points: readonly Point[] }[]) {
  const samples: SlopeSample[] = [];
  for (const { points } of lines) {
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (a === undefined || b === undefined || b.x - a.x <= 0) continue;
      samples.push({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        slope: (b.y - a.y) / (b.x - a.x),
        weight: b.x - a.x,
      });
    }
  }
  return samples;
}

function basis(x: number, y: number, width: number, height: number): Map<number, number> {
  const spacing = width / (KNOTS - 1);
  const position = Math.max(0, Math.min(KNOTS - 1, x / spacing));
  const knot = Math.min(KNOTS - 2, Math.floor(position));
  const share = position - knot;
  const v = (2 * y) / height - 1;
  const powers = [1, v, v * v];
  const terms = new Map<number, number>();
  powers.forEach((power, j) => {
    terms.set(knot * 3 + j, (1 - share) * power);
    terms.set((knot + 1) * 3 + j, share * power);
  });
  return terms;
}

function evaluate(coefficients: readonly number[], terms: Map<number, number>): number {
  let sum = 0;
  for (const [index, value] of terms) sum += (coefficients[index] ?? 0) * value;
  return sum;
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2 === 1
    ? (sorted[Math.floor(middle)] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function weightedMedianSlope(samples: readonly SlopeSample[]): number {
  const sorted = samples.toSorted((a, b) => a.slope - b.slope);
  const total = sorted.reduce((sum, sample) => sum + sample.weight, 0);
  let seen = 0;
  for (const sample of sorted) {
    seen += sample.weight;
    if (seen >= total / 2) return sample.slope;
  }
  return 0;
}

export function fitSlopes(
  samples: readonly SlopeSample[],
  width: number,
  height: number,
): SlopeModel | null {
  if (samples.length < MIN_SAMPLES) return null;
  const size = KNOTS * 3;
  const rows = samples.map((sample) => basis(sample.x, sample.y, width, height));
  const weights = samples.map((sample) => sample.weight);
  let coefficients: number[] | null = null;
  let spread = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    const rhs = Array.from({ length: size }, () => 0);
    let total = 0;
    rows.forEach((terms, i) => {
      const w = weights[i] ?? 0;
      total += w;
      const slope = samples[i]?.slope ?? 0;
      for (const [a, va] of terms) {
        rhs[a] = (rhs[a] ?? 0) + w * va * slope;
        const row = matrix[a];
        if (row === undefined) continue;
        for (const [b, vb] of terms) row[b] = (row[b] ?? 0) + w * va * vb;
      }
    });
    const scale = total / KNOTS;
    for (let j = 0; j < 3; j += 1) {
      for (let i = 1; i + 1 < KNOTS; i += 1) {
        const stencil: [number, number][] = [
          [(i - 1) * 3 + j, 1],
          [i * 3 + j, -2],
          [(i + 1) * 3 + j, 1],
        ];
        for (const [a, va] of stencil) {
          const row = matrix[a];
          if (row === undefined) continue;
          for (const [b, vb] of stencil) row[b] = (row[b] ?? 0) + ROUGHNESS * scale * va * vb;
        }
      }
    }
    for (let a = 0; a < size; a += 1) {
      const row = matrix[a];
      if (row !== undefined) row[a] = (row[a] ?? 0) + RIDGE * scale;
    }
    coefficients = solveLinear(matrix, rhs);
    if (coefficients === null) return null;
    const fitted = coefficients;
    const residuals = rows.map((terms, i) => (samples[i]?.slope ?? 0) - evaluate(fitted, terms));
    spread = 1.4826 * median(residuals.map(Math.abs));
    const limit = Math.max(HUBER * spread, 1e-3);
    residuals.forEach((residual, i) => {
      const base = samples[i]?.weight ?? 0;
      weights[i] = Math.abs(residual) <= limit ? base : (base * limit) / Math.abs(residual);
    });
  }
  if (coefficients === null) return null;
  const fitted = coefficients;
  const top = Math.min(...samples.map((sample) => sample.y));
  const bottom = Math.max(...samples.map((sample) => sample.y));
  return {
    slopeAt: (x, y) =>
      evaluate(fitted, basis(x, Math.max(top, Math.min(bottom, y)), width, height)),
    samples: samples.length,
    spread,
    top,
    bottom,
  };
}
