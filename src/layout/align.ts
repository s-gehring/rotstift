import { item, median } from './signal.ts';

export interface AlignInput {
  readonly widths: readonly number[];
  readonly rows: readonly number[];
  readonly substantial: readonly boolean[];
  readonly lengths: readonly number[];
  readonly blanksBefore: readonly number[];
  readonly pitch: number;
  readonly pixelsPerChar: number;
}

export interface AlignedGroup {
  readonly detected: readonly number[];
  readonly transcript: readonly number[];
  readonly marginal: number;
}

const MERGE_PENALTY = 0.6;
const SPLIT_PENALTY = 1.0;
const SKIP_TRANSCRIPT_BASE = 1.0;
const SKIP_DETECTED_BASE = 0.25;
const SHORT_LINE_DAMPING = 3;
const MAX_GROUP = 3;
const MAX_SKIP = 6;
const GAP_TOLERANCE = 0.4;
const GAP_WEIGHT = 3;
const GAP_CAP = 3;
const SHARPNESS = 3;

export function mismatch(inkChars: number, chars: number): number {
  return Math.abs(Math.log((inkChars + SHORT_LINE_DAMPING) / (chars + SHORT_LINE_DAMPING)));
}

interface Edge {
  readonly from: number;
  readonly to: number;
  readonly firstDetected: number;
  readonly detectedCount: number;
  readonly firstTranscript: number;
  readonly transcriptCount: number;
  readonly cost: number;
}

function logSumExp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const high = Math.max(a, b);
  return high + Math.log(Math.exp(a - high) + Math.exp(b - high));
}

function prefix(values: readonly number[]): number[] {
  const sums = [0];
  for (const value of values) sums.push((sums[sums.length - 1] ?? 0) + value);
  return sums;
}

export function align(input: AlignInput, withMarginals: boolean): AlignedGroup[] {
  const { widths, rows, substantial, lengths, blanksBefore, pitch, pixelsPerChar } = input;
  const n = widths.length;
  const m = lengths.length;
  const stride = m + 1;
  const typical = Math.max(1, median(lengths));
  const inkChars = widths.map((width) => width / pixelsPerChar);

  const detectedSkip = prefix(
    inkChars.map((chars) => SKIP_DETECTED_BASE + 0.7 * Math.min(1, chars / typical)),
  );
  const transcriptSkip = prefix(
    lengths.map((length) => SKIP_TRANSCRIPT_BASE + 0.5 * Math.min(1, length / typical)),
  );
  const substantialCount = prefix(substantial.map((flag) => (flag ? 1 : 0)));
  const widthSum = prefix(inkChars);
  const lengthSum = prefix(lengths);
  const skippedRows = prefix(lengths.map((_, j) => 1 + (blanksBefore[j] ?? 0)));

  const edgesFrom = (i0: number, j0: number, visit: (edge: Edge) => void) => {
    const start = i0 === 0 && j0 === 0;
    const detectedReach = start ? n : MAX_SKIP;
    const transcriptReach = start ? m : MAX_SKIP;
    for (let sd = 0; sd <= detectedReach && i0 + sd < n; sd += 1) {
      const ds = i0 + sd;
      const skipped = item(detectedSkip, ds) - item(detectedSkip, i0);
      const extraRows = item(substantialCount, ds) - item(substantialCount, i0);
      for (let st = 0; st <= transcriptReach && j0 + st < m; st += 1) {
        const js = j0 + st;
        const skippedTranscript = item(transcriptSkip, js) - item(transcriptSkip, j0);
        let gap = 0;
        if (!start) {
          const expected =
            1 +
            (blanksBefore[js] ?? 0) +
            (item(skippedRows, js) - item(skippedRows, j0)) +
            extraRows;
          const actual = ((rows[ds] ?? 0) - (rows[i0 - 1] ?? 0)) / pitch;
          gap = Math.min(
            GAP_CAP,
            GAP_WEIGHT * Math.max(0, Math.abs(actual - expected) - GAP_TOLERANCE),
          );
        }
        const base = skipped + skippedTranscript + gap;
        for (let a = 1; a <= MAX_GROUP && ds + a <= n; a += 1) {
          for (let b = 1; b <= MAX_GROUP && js + b <= m; b += 1) {
            if (a > 1 && b > 1) continue;
            const ink = item(widthSum, ds + a) - item(widthSum, ds);
            const chars = item(lengthSum, js + b) - item(lengthSum, js);
            const match = mismatch(ink, chars) + MERGE_PENALTY * (a - 1) + SPLIT_PENALTY * (b - 1);
            visit({
              from: i0 * stride + j0,
              to: (ds + a) * stride + js + b,
              firstDetected: ds,
              detectedCount: a,
              firstTranscript: js,
              transcriptCount: b,
              cost: base + match,
            });
          }
        }
      }
    }
  };

  const finalCost = (i: number, j: number) =>
    item(detectedSkip, n) -
    item(detectedSkip, i) +
    (item(transcriptSkip, m) - item(transcriptSkip, j));

  const states = (n + 1) * stride;
  const best = new Float64Array(states).fill(Infinity);
  const alpha = new Float64Array(states).fill(-Infinity);
  const through = Array.from<Edge | null>({ length: states }).fill(null);
  best[0] = 0;
  alpha[0] = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const here = i * stride + j;
      const cost = best[here] ?? Infinity;
      if (cost === Infinity) continue;
      const weight = alpha[here] ?? -Infinity;
      edgesFrom(i, j, (edge) => {
        if (cost + edge.cost < (best[edge.to] ?? Infinity)) {
          best[edge.to] = cost + edge.cost;
          through[edge.to] = edge;
        }
        if (withMarginals)
          alpha[edge.to] = logSumExp(alpha[edge.to] ?? -Infinity, weight - SHARPNESS * edge.cost);
      });
    }
  }

  let end = 0;
  let endCost = Infinity;
  let normaliser = -Infinity;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      const state = i * stride + j;
      const total = (best[state] ?? Infinity) + finalCost(i, j);
      if (total < endCost) {
        endCost = total;
        end = state;
      }
      if (withMarginals)
        normaliser = logSumExp(
          normaliser,
          (alpha[state] ?? -Infinity) - SHARPNESS * finalCost(i, j),
        );
    }
  }

  const path: Edge[] = [];
  for (let state = end; state !== 0;) {
    const edge = through[state];
    if (edge === null || edge === undefined) break;
    path.push(edge);
    state = edge.from;
  }
  path.reverse();

  const marginals = new Map<string, number>();
  const key = (edge: Edge) =>
    `${edge.firstDetected}:${edge.detectedCount}:${edge.firstTranscript}:${edge.transcriptCount}`;
  if (withMarginals) {
    const beta = new Float64Array(states).fill(-Infinity);
    for (let i = n; i >= 0; i -= 1) {
      for (let j = m; j >= 0; j -= 1) {
        const here = i * stride + j;
        let value = -SHARPNESS * finalCost(i, j);
        if (i < n && j < m) {
          edgesFrom(i, j, (edge) => {
            value = logSumExp(value, -SHARPNESS * edge.cost + (beta[edge.to] ?? -Infinity));
          });
        }
        beta[here] = value;
      }
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < m; j += 1) {
        const weight = alpha[i * stride + j] ?? -Infinity;
        if (weight === -Infinity) continue;
        edgesFrom(i, j, (edge) => {
          const posterior = Math.exp(
            weight - SHARPNESS * edge.cost + (beta[edge.to] ?? -Infinity) - normaliser,
          );
          marginals.set(key(edge), (marginals.get(key(edge)) ?? 0) + posterior);
        });
      }
    }
  }

  return path.map((edge) => ({
    detected: Array.from({ length: edge.detectedCount }, (_, k) => edge.firstDetected + k),
    transcript: Array.from({ length: edge.transcriptCount }, (_, k) => edge.firstTranscript + k),
    marginal: withMarginals ? Math.min(1, marginals.get(key(edge)) ?? 0) : 1,
  }));
}
