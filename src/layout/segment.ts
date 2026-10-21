import { labelComponents, type InkMask } from './ink.ts';
import { autocorrelation, gaussianSmooth, item, median, percentile } from './signal.ts';
import type { LineBand, Point } from './types.ts';

export interface DetectedLine {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly inkCount: number;
  readonly band: LineBand;
}

export interface Segmentation {
  readonly lines: readonly DetectedLine[];
  readonly pitch: number;
}

const MIN_STRIPS = 4;
const MAX_STRIPS = 16;
const STRIP_PITCHES = 3;
const PITCH_STRIPS = 8;
const TRACK_TOLERANCE = 0.45;
const MAX_MISSES = 2;
const MAX_STEP_SLOPE = 0.25;
const SLOPE_POINTS = 4;
const WEAK_PEAK = 0.12;
const JOIN_TOLERANCE = 0.3;
const REACH_STRIPS = 1.5;
const MAX_DISTANCE = 1.1;
const REGISTER_ROUNDS = 2;
const REGISTER_SHIFT = 0.25;
const MIN_BAND_PIXELS = 12;
const MIN_LINE_SHARE = 0.06;
const EDGE_TRIM = 0.001;
const ISOLATED_GAP = 1.5;
const ISOLATED_ROW_GAP = 0.18;
const DOMINANT_SHARE = 0.6;
const DOMINANT_SPAN = 2;
const DOMINANT_HEIGHT = 1.25;
const ISOLATED_SHARE = 0.05;

interface Peak {
  position: number;
  height: number;
}

function pitchFromCorrelation(
  correlation: Float64Array,
  lowest: number,
  highest: number,
  fallback: number,
): number {
  if (highest <= lowest + 2) return fallback;
  let strongest = 0;
  for (let lag = lowest; lag <= highest; lag += 1) {
    strongest = Math.max(strongest, correlation[lag] ?? 0);
  }
  if (strongest < 0.12) return fallback;
  for (let lag = lowest + 1; lag < highest; lag += 1) {
    const value = correlation[lag] ?? 0;
    if (
      value >= strongest * 0.7 &&
      value >= (correlation[lag - 1] ?? 0) &&
      value >= (correlation[lag + 1] ?? 0)
    ) {
      return lag;
    }
  }
  return fallback;
}

function estimatePitch(profiles: readonly Float64Array[], fallback: number): number {
  const length = profiles[0]?.length ?? 0;
  const lowest = 10;
  const highest = Math.min(Math.floor(length / 3), 200);
  if (highest <= lowest + 2) return fallback;
  const combined = new Float64Array(highest + 1);
  let total = 0;
  for (const profile of profiles) {
    let ink = 0;
    for (let i = 0; i < profile.length; i += 1) ink += profile[i] ?? 0;
    if (ink === 0) continue;
    const correlation = autocorrelation(gaussianSmooth(profile, 1.5), highest + 1);
    for (let lag = 0; lag <= highest; lag += 1) {
      combined[lag] = (combined[lag] ?? 0) + (correlation[lag] ?? 0) * ink;
    }
    total += ink;
  }
  if (total === 0) return fallback;
  for (let lag = 0; lag <= highest; lag += 1) combined[lag] = (combined[lag] ?? 0) / total;
  return pitchFromCorrelation(combined, lowest, highest, fallback);
}

function findPeaks(smooth: Float64Array, pitch: number): Peak[] {
  const reach = Math.max(2, Math.round(pitch * 0.3));
  const candidates: Peak[] = [];
  for (let i = 0; i < smooth.length; i += 1) {
    const value = smooth[i] ?? 0;
    if (value <= 0) continue;
    let isPeak = true;
    for (let d = -reach; d <= reach && isPeak; d += 1) {
      const other = smooth[i + d];
      if (d !== 0 && other !== undefined && (other > value || (other === value && d < 0))) {
        isPeak = false;
      }
    }
    if (isPeak) candidates.push({ position: i, height: value });
  }
  const ranked = candidates.toSorted((a, b) => b.height - a.height);
  const accepted: Peak[] = [];
  for (const candidate of ranked) {
    if (accepted.every((peak) => Math.abs(peak.position - candidate.position) >= pitch * 0.55)) {
      accepted.push(candidate);
    }
  }
  const strongest = accepted[0]?.height ?? 0;
  const reference = median(
    accepted.filter((p) => p.height >= strongest * 0.2).map((p) => p.height),
  );
  return accepted
    .filter((peak) => peak.height >= reference * 0.08)
    .toSorted((a, b) => a.position - b.position);
}

function findValley(values: Float64Array, from: number, to: number): number {
  const middle = (from + to) / 2;
  let best = Math.round(middle);
  let bestValue = Infinity;
  for (let i = Math.ceil(from); i <= Math.floor(to); i += 1) {
    const value = values[i] ?? 0;
    if (
      value < bestValue - 1e-9 ||
      (Math.abs(value - bestValue) <= 1e-9 && Math.abs(i - middle) < Math.abs(best - middle))
    ) {
      bestValue = value;
      best = i;
    }
  }
  return best;
}

function mergeShallowPeaks(peaks: Peak[], tight: Float64Array, pitch: number): Peak[] {
  let current = peaks;
  let changed = true;
  while (changed && current.length > 1) {
    changed = false;
    for (let i = 0; i + 1 < current.length; i += 1) {
      const a = item(current, i);
      const b = item(current, i + 1);
      const distance = b.position - a.position;
      const valley =
        tight[findValley(tight, a.position + distance * 0.2, b.position - distance * 0.2)] ?? 0;
      if (distance < pitch * 0.85 && valley >= Math.min(a.height, b.height) * 0.85) {
        current = current.filter((peak) => peak !== (a.height >= b.height ? b : a));
        changed = true;
        break;
      }
    }
  }
  return current;
}

function isolatedEnds(sorted: Float64Array, minGap: number): [number, number] {
  let first = 0;
  let last = sorted.length - 1;
  for (let i = 0; i < sorted.length - 1 && i < sorted.length * ISOLATED_SHARE; i += 1) {
    if ((sorted[i + 1] ?? 0) - (sorted[i] ?? 0) > minGap) first = i + 1;
  }
  for (
    let i = sorted.length - 1;
    i > 0 && sorted.length - i < sorted.length * ISOLATED_SHARE;
    i -= 1
  ) {
    if ((sorted[i] ?? 0) - (sorted[i - 1] ?? 0) > minGap) last = i - 1;
  }
  return [first, Math.max(first, last)];
}

function trimmedRange(sorted: Float64Array, pitch: number): [number, number] {
  const [first, last] = isolatedEnds(sorted, pitch * ISOLATED_ROW_GAP);
  const kept = sorted.subarray(first, last + 1);
  return [Math.floor(percentile(kept, EDGE_TRIM)), Math.ceil(percentile(kept, 1 - EDGE_TRIM)) + 1];
}

function medianOfThree(values: number[]): number[] {
  return values.map((value, i) => {
    const a = values[Math.max(0, i - 1)] ?? value;
    const b = values[Math.min(values.length - 1, i + 1)] ?? value;
    return median([a, value, b]);
  });
}

interface Track {
  readonly strips: number[];
  readonly ys: number[];
  misses: number;
}

function stripProfiles(
  xs: Int32Array,
  rows: Int32Array,
  width: number,
  length: number,
  strips: number,
): Float64Array[] {
  const step = width / strips;
  const profiles = Array.from({ length: strips }, () => new Float64Array(length));
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i] ?? 0;
    const row = rows[i] ?? 0;
    const first = Math.floor(x / step - 0.5);
    for (let s = Math.max(0, first); s <= Math.min(strips - 1, first + 1); s += 1) {
      if (Math.abs(x - (s + 0.5) * step) < step) {
        const profile = item(profiles, s);
        profile[row] = (profile[row] ?? 0) + 1;
      }
    }
  }
  return profiles;
}

function predict(track: Track, strip: number, pitch: number): number {
  const count = track.strips.length;
  const lastStrip = item(track.strips, count - 1);
  const lastY = item(track.ys, count - 1);
  const from = Math.max(0, count - SLOPE_POINTS);
  if (count - from < 2) return lastY;
  let meanS = 0;
  let meanY = 0;
  for (let i = from; i < count; i += 1) {
    meanS += item(track.strips, i);
    meanY += item(track.ys, i);
  }
  meanS /= count - from;
  meanY /= count - from;
  let covariance = 0;
  let variance = 0;
  for (let i = from; i < count; i += 1) {
    const ds = item(track.strips, i) - meanS;
    covariance += ds * (item(track.ys, i) - meanY);
    variance += ds * ds;
  }
  const limit = pitch * MAX_STEP_SLOPE;
  const slope = variance > 0 ? Math.max(-limit, Math.min(limit, covariance / variance)) : 0;
  return lastY + slope * (strip - lastStrip);
}

function matchOrdered(
  predicted: readonly number[],
  found: readonly number[],
  tolerance: number,
): number[] {
  const n = predicted.length;
  const m = found.length;
  const stride = m + 1;
  const cost = new Float64Array((n + 1) * stride);
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (i === 0 || j === 0) {
        cost[i * stride + j] = i + j;
        continue;
      }
      let best = Math.min(
        (cost[(i - 1) * stride + j] ?? 0) + 1,
        (cost[i * stride + j - 1] ?? 0) + 1,
      );
      const distance = Math.abs(item(predicted, i - 1) - item(found, j - 1));
      if (distance < tolerance) {
        best = Math.min(best, (cost[(i - 1) * stride + j - 1] ?? 0) + (distance / tolerance) ** 2);
      }
      cost[i * stride + j] = best;
    }
  }
  const matches = Array.from({ length: n }, () => -1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = cost[i * stride + j] ?? 0;
    const distance = Math.abs(item(predicted, i - 1) - item(found, j - 1));
    if (
      distance < tolerance &&
      Math.abs(here - ((cost[(i - 1) * stride + j - 1] ?? 0) + (distance / tolerance) ** 2)) < 1e-9
    ) {
      matches[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else if (Math.abs(here - ((cost[(i - 1) * stride + j] ?? 0) + 1)) < 1e-9) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return matches;
}

function trackLines(peaksPerStrip: readonly (readonly Peak[])[], pitch: number): Track[] {
  const tolerance = pitch * TRACK_TOLERANCE;
  const finished: Track[] = [];
  let active: Track[] = [];
  peaksPerStrip.forEach((peaks, strip) => {
    const predicted = active.map((track) => predict(track, strip, pitch));
    const order = active
      .map((_, index) => index)
      .toSorted((a, b) => item(predicted, a) - item(predicted, b));
    const matches = matchOrdered(
      order.map((index) => item(predicted, index)),
      peaks.map((peak) => peak.position),
      tolerance,
    );
    const used = new Set<number>();
    const next: Track[] = [];
    order.forEach((index, rank) => {
      const track = item(active, index);
      const match = item(matches, rank);
      if (match >= 0) {
        track.strips.push(strip);
        track.ys.push(item(peaks, match).position);
        track.misses = 0;
        used.add(match);
        next.push(track);
      } else if (track.misses < MAX_MISSES) {
        track.misses += 1;
        next.push(track);
      } else {
        finished.push(track);
      }
    });
    peaks.forEach((peak, index) => {
      if (!used.has(index)) next.push({ strips: [strip], ys: [peak.position], misses: 0 });
    });
    active = next;
  });
  return joinTracks([...finished, ...active], pitch);
}

function joinTracks(tracks: Track[], pitch: number): Track[] {
  const tolerance = pitch * JOIN_TOLERANCE;
  const sorted = tracks.toSorted((a, b) => item(a.strips, 0) - item(b.strips, 0));
  const joined: Track[] = [];
  for (const track of sorted) {
    const start = item(track.strips, 0);
    let best: Track | null = null;
    let bestDistance = tolerance;
    for (const candidate of joined) {
      if (item(candidate.strips, candidate.strips.length - 1) >= start) continue;
      const distance = Math.abs(predict(candidate, start, pitch) - item(track.ys, 0));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    if (best === null) {
      joined.push({ strips: [...track.strips], ys: [...track.ys], misses: 0 });
    } else {
      best.strips.push(...track.strips);
      best.ys.push(...track.ys);
    }
  }
  return joined;
}

function centerline(track: Track, step: number, width: number): Float64Array {
  const ys = track.ys.length >= 3 ? medianOfThree(track.ys) : track.ys;
  const curve = new Float64Array(width);
  let k = 0;
  for (let x = 0; x < width; x += 1) {
    while (k + 1 < track.strips.length && (item(track.strips, k + 1) + 0.5) * step <= x) k += 1;
    const leftX = (item(track.strips, k) + 0.5) * step;
    const leftY = item(ys, k);
    if (x <= leftX || k + 1 >= track.strips.length) {
      curve[x] = leftY;
      continue;
    }
    const rightX = (item(track.strips, k + 1) + 0.5) * step;
    curve[x] = leftY + ((item(ys, k + 1) - leftY) * (x - leftX)) / (rightX - leftX);
  }
  return curve;
}

function nearestBands(
  tracks: readonly Track[],
  curves: readonly Float64Array[],
  xs: Int32Array,
  rows: Int32Array,
  step: number,
  reach: number,
  limit: number,
): Int16Array {
  const width = curves[0]?.length ?? 0;
  const spans = tracks.map((track) => ({
    from: (item(track.strips, 0) + 0.5) * step - reach,
    to: (item(track.strips, track.strips.length - 1) + 0.5) * step + reach,
  }));
  const columns: Int32Array[] = [];
  for (let x = 0; x < width; x += 1) {
    let present = tracks
      .map((_, index) => index)
      .filter((index) => item(spans, index).from <= x && x <= item(spans, index).to);
    if (present.length === 0) present = tracks.map((_, index) => index);
    present.sort((a, b) => (item(curves, a)[x] ?? 0) - (item(curves, b)[x] ?? 0));
    columns.push(Int32Array.from(present));
  }
  const bandOf = new Int16Array(xs.length).fill(-1);
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i] ?? 0;
    const row = rows[i] ?? 0;
    const column = item(columns, x);
    let low = 0;
    let high = column.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      const upper = item(curves, item(column, middle))[x] ?? 0;
      const lower = item(curves, item(column, middle + 1))[x] ?? 0;
      if (row > (upper + lower) / 2) low = middle + 1;
      else high = middle;
    }
    const band = item(column, low);
    if (Math.abs(row - (item(curves, band)[x] ?? 0)) <= limit) bandOf[i] = band;
  }
  return bandOf;
}

function register(
  tracks: readonly Track[],
  curves: readonly Float64Array[],
  bandOf: Int16Array,
  xs: Int32Array,
  rows: Int32Array,
  step: number,
  pitch: number,
): void {
  const radius = Math.ceil(pitch * MAX_DISTANCE);
  const size = radius * 2 + 1;
  const shift = Math.max(1, Math.round(pitch * REGISTER_SHIFT));
  const local = tracks.map((track) => track.strips.map(() => new Float64Array(size)));
  const whole = tracks.map(() => new Float64Array(size));
  for (let i = 0; i < xs.length; i += 1) {
    const band = bandOf[i] ?? -1;
    if (band < 0) continue;
    const x = xs[i] ?? 0;
    const offset = Math.round((rows[i] ?? 0) - (item(curves, band)[x] ?? 0)) + radius;
    if (offset < 0 || offset >= size) continue;
    const total = item(whole, band);
    total[offset] = (total[offset] ?? 0) + 1;
    const track = item(tracks, band);
    track.strips.forEach((strip, k) => {
      if (Math.abs(x - (strip + 0.5) * step) < step) {
        const histogram = item(item(local, band), k);
        histogram[offset] = (histogram[offset] ?? 0) + 1;
      }
    });
  }
  tracks.forEach((track, band) => {
    const template = gaussianSmooth(item(whole, band), pitch * 0.05);
    track.strips.forEach((_, k) => {
      const histogram = gaussianSmooth(item(item(local, band), k), pitch * 0.05);
      let best = 0;
      let bestScore = -1;
      for (let d = -shift; d <= shift; d += 1) {
        let score = 0;
        for (let r = 0; r < size; r += 1) {
          score += (histogram[r] ?? 0) * (template[r - d] ?? 0);
        }
        if (
          score > bestScore + 1e-9 ||
          (Math.abs(score - bestScore) <= 1e-9 && Math.abs(d) < Math.abs(best))
        ) {
          bestScore = score;
          best = d;
        }
      }
      track.ys[k] = item(track.ys, k) + best;
    });
  });
}

export function segmentLines(mask: InkMask, bridges: InkMask, tan: number): Segmentation {
  const { width, height, data } = mask;
  const fallbackPitch = Math.max(12, Math.round(height * 0.04));
  const offset = Math.ceil(width * Math.abs(tan)) + 1;
  const shearedHeight = height + offset * 2;

  let total = 0;
  for (let i = 0; i < data.length; i += 1) total += data[i] ?? 0;
  if (total < MIN_BAND_PIXELS) return { lines: [], pitch: fallbackPitch };
  const xs = new Int32Array(total);
  const ys = new Int32Array(total);
  const sheared = new Int32Array(total);
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] !== 1) continue;
      xs[count] = x;
      ys[count] = y;
      sheared[count] = y - Math.round(x * tan) + offset;
      count += 1;
    }
  }

  const pitch = estimatePitch(
    stripProfiles(xs, sheared, width, shearedHeight, PITCH_STRIPS),
    fallbackPitch,
  );
  const strips = Math.min(
    MAX_STRIPS,
    Math.max(MIN_STRIPS, Math.round(width / (pitch * STRIP_PITCHES))),
  );
  const step = width / strips;
  const peaksPerStrip = stripProfiles(xs, sheared, width, shearedHeight, strips).map((profile) => {
    const smooth = gaussianSmooth(profile, pitch * 0.1);
    const tight = gaussianSmooth(profile, pitch * 0.05);
    return mergeShallowPeaks(findPeaks(smooth, pitch), tight, pitch);
  });
  const reference = median(peaksPerStrip.flat().map((peak) => peak.height));
  const strong = peaksPerStrip.map((peaks) =>
    peaks.filter((peak) => peak.height >= reference * WEAK_PEAK),
  );
  const tracks = trackLines(strong, pitch);
  if (tracks.length === 0) return { lines: [], pitch };

  const reach = step * REACH_STRIPS;
  const limit = pitch * MAX_DISTANCE;
  let curves = tracks.map((track) => centerline(track, step, width));
  let bandOf = nearestBands(tracks, curves, xs, sheared, step, reach, limit);
  for (let round = 0; round < REGISTER_ROUNDS; round += 1) {
    register(tracks, curves, bandOf, xs, sheared, step, pitch);
    curves = tracks.map((track) => centerline(track, step, width));
    bandOf = nearestBands(tracks, curves, xs, sheared, step, reach, limit);
  }

  const bandCount = tracks.length;
  const components = labelComponents(bridges);
  const histogram = new Int32Array(components.count * bandCount);
  const labelOf = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    const band = bandOf[i] ?? -1;
    if (band < 0) continue;
    const label = components.labels[(ys[i] ?? 0) * width + (xs[i] ?? 0)] ?? 0;
    labelOf[i] = label;
    const slot = label * bandCount + band;
    histogram[slot] = (histogram[slot] ?? 0) + 1;
  }
  const dominant = new Int16Array(components.count).fill(-1);
  for (let label = 1; label < components.count; label += 1) {
    let members = 0;
    let best = 0;
    let bestBand = -1;
    for (let b = 0; b < bandCount; b += 1) {
      const value = histogram[label * bandCount + b] ?? 0;
      members += value;
      if (value > best) {
        best = value;
        bestBand = b;
      }
    }
    const span = (components.maxX[label] ?? 0) - (components.minX[label] ?? 0) + 1;
    const tall = (components.maxY[label] ?? 0) - (components.minY[label] ?? 0) + 1;
    const compact = span <= pitch * DOMINANT_SPAN && tall <= pitch * DOMINANT_HEIGHT;
    if (members > 0 && compact && best >= members * DOMINANT_SHARE) {
      dominant[label] = bestBand;
    }
  }
  const bandX: number[][] = tracks.map(() => []);
  const bandY: number[][] = tracks.map(() => []);
  const bandR: number[][] = tracks.map(() => []);
  for (let i = 0; i < count; i += 1) {
    if ((bandOf[i] ?? -1) < 0) continue;
    const owner = dominant[labelOf[i] ?? 0] ?? -1;
    const band = owner >= 0 ? owner : (bandOf[i] ?? 0);
    const x = xs[i] ?? 0;
    item(bandX, band).push(x);
    item(bandY, band).push(ys[i] ?? 0);
    item(bandR, band).push((ys[i] ?? 0) - (item(curves, band)[x] ?? 0) - x * tan + offset);
  }

  const found: { line: DetectedLine; row: number }[] = [];
  tracks.forEach((track, b) => {
    const px = Float64Array.from(item(bandX, b)).toSorted();
    const py = Float64Array.from(item(bandY, b)).toSorted();
    const pr = Float64Array.from(item(bandR, b)).toSorted();
    if (px.length < MIN_BAND_PIXELS) return;
    const [first, last] = isolatedEnds(px, pitch * ISOLATED_GAP);
    const kept = px.subarray(first, last + 1);
    const x0 = Math.floor(percentile(kept, EDGE_TRIM));
    const x1 = Math.ceil(percentile(kept, 1 - EDGE_TRIM)) + 1;
    const [y0, y1] = trimmedRange(py, pitch);
    const [r0, r1] = trimmedRange(pr, pitch);
    const curve = item(curves, b);
    const topAtX = (x: number) => {
      const at = Math.min(width - 1, Math.max(0, Math.round(x)));
      return (curve[at] ?? 0) + x * tan - offset + r0;
    };
    const top: Point[] = [{ x: x0, y: topAtX(x0) }];
    for (const strip of track.strips) {
      const x = (strip + 0.5) * step;
      if (x > x0 && x < x1) top.push({ x, y: topAtX(x) });
    }
    top.push({ x: x1, y: topAtX(x1) });
    const bandHeight = r1 - r0;
    const middle = Math.min(width - 1, Math.max(0, Math.round((x0 + x1) / 2)));
    found.push({
      line: {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        inkCount: px.length,
        band: { top, height: bandHeight },
      },
      row: curve[middle] ?? 0,
    });
  });
  const typical = median(found.map((entry) => entry.line.inkCount));
  return {
    lines: found
      .filter((entry) => entry.line.inkCount >= typical * MIN_LINE_SHARE)
      .toSorted((a, b) => a.row - b.row)
      .map((entry) => entry.line),
    pitch,
  };
}
