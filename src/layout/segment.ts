import { labelComponents, type InkMask } from './ink.ts';
import { autocorrelation, gaussianSmooth, item, median, percentile } from './signal.ts';

export interface DetectedLine {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly inkCount: number;
}

export interface Segmentation {
  readonly lines: readonly DetectedLine[];
  readonly pitch: number;
}

const STRIP_COUNT = 6;
const MIN_BAND_PIXELS = 12;
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

function estimatePitch(profile: Float64Array, fallback: number): number {
  const smooth = gaussianSmooth(profile, 1.5);
  const lowest = 10;
  const highest = Math.min(Math.floor(smooth.length / 3), 200);
  if (highest <= lowest + 2) return fallback;
  const correlation = autocorrelation(smooth, highest + 1);
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

function medianOfThree(values: number[]): number[] {
  return values.map((value, i) => {
    const a = values[Math.max(0, i - 1)] ?? value;
    const b = values[Math.min(values.length - 1, i + 1)] ?? value;
    return median([a, value, b]);
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
  const profile = new Float64Array(shearedHeight);
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] !== 1) continue;
      const row = y - Math.round(x * tan) + offset;
      xs[count] = x;
      ys[count] = y;
      sheared[count] = row;
      profile[row] = (profile[row] ?? 0) + 1;
      count += 1;
    }
  }

  const pitch = estimatePitch(profile, fallbackPitch);
  const smooth = gaussianSmooth(profile, pitch * 0.1);
  const tight = gaussianSmooth(profile, pitch * 0.05);
  const peaks = mergeShallowPeaks(findPeaks(smooth, pitch), tight, pitch);
  if (peaks.length === 0) return { lines: [], pitch };

  const valleys: number[] = [];
  for (let i = 0; i + 1 < peaks.length; i += 1) {
    const a = item(peaks, i);
    const b = item(peaks, i + 1);
    const distance = b.position - a.position;
    valleys.push(findValley(tight, a.position + distance * 0.2, b.position - distance * 0.2));
  }

  const strips: Float64Array[] = [];
  const stripWidth = width / STRIP_COUNT;
  for (let s = 0; s < STRIP_COUNT; s += 1) {
    const from = (s + 0.5) * stripWidth - stripWidth;
    const to = (s + 0.5) * stripWidth + stripWidth;
    const local = new Float64Array(shearedHeight);
    for (let i = 0; i < count; i += 1) {
      const x = xs[i] ?? 0;
      if (x >= from && x < to) local[sheared[i] ?? 0] = (local[sheared[i] ?? 0] ?? 0) + 1;
    }
    strips.push(gaussianSmooth(local, pitch * 0.1));
  }

  const cuts: Float64Array[] = valleys.map((valley, k) => {
    const upper = item(peaks, k);
    const lower = item(peaks, k + 1);
    const from = Math.max(upper.position + pitch * 0.1, valley - pitch * 0.3);
    const to = Math.min(lower.position - pitch * 0.1, valley + pitch * 0.3);
    const stripValues = strips.map((strip) => {
      let reference = 0;
      for (let y = Math.ceil(upper.position); y <= Math.floor(lower.position); y += 1) {
        reference = Math.max(reference, strip[y] ?? 0);
      }
      if (reference < 1) return valley;
      let best = valley;
      let bestCost = Infinity;
      for (let y = Math.ceil(from); y <= Math.floor(to); y += 1) {
        const cost = (strip[y] ?? 0) / reference + (0.2 * Math.abs(y - valley)) / (pitch * 0.3);
        if (cost < bestCost) {
          bestCost = cost;
          best = y;
        }
      }
      return best;
    });
    const smoothed = medianOfThree(stripValues);
    const curve = new Float64Array(width);
    for (let x = 0; x < width; x += 1) {
      const position = x / stripWidth - 0.5;
      const left = Math.min(STRIP_COUNT - 1, Math.max(0, Math.floor(position)));
      const right = Math.min(STRIP_COUNT - 1, left + 1);
      const fraction = Math.min(1, Math.max(0, position - left));
      curve[x] =
        (smoothed[left] ?? valley) * (1 - fraction) + (smoothed[right] ?? valley) * fraction;
    }
    return curve;
  });
  for (let k = 1; k < cuts.length; k += 1) {
    const previous = item(cuts, k - 1);
    const current = item(cuts, k);
    for (let x = 0; x < width; x += 1)
      current[x] = Math.max(current[x] ?? 0, (previous[x] ?? 0) + 2);
  }

  const top = item(peaks, 0).position - pitch * 1.1;
  const bottom = item(peaks, peaks.length - 1).position + pitch * 1.1;
  const bandCount = peaks.length;
  const bandOf = new Int16Array(count).fill(-1);
  const components = labelComponents(bridges);
  const histogram = new Int32Array(components.count * bandCount);
  const labelOf = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    const row = sheared[i] ?? 0;
    if (row < top || row > bottom) continue;
    const x = xs[i] ?? 0;
    let low = 0;
    let high = cuts.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((item(cuts, middle)[x] ?? 0) <= row) low = middle + 1;
      else high = middle;
    }
    bandOf[i] = low;
    const label = components.labels[(ys[i] ?? 0) * width + x] ?? 0;
    labelOf[i] = label;
    const slot = label * bandCount + low;
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
  const bandX: number[][] = peaks.map(() => []);
  const bandY: number[][] = peaks.map(() => []);
  for (let i = 0; i < count; i += 1) {
    if ((bandOf[i] ?? -1) < 0) continue;
    const owner = dominant[labelOf[i] ?? 0] ?? -1;
    const band = owner >= 0 ? owner : (bandOf[i] ?? 0);
    item(bandX, band).push(xs[i] ?? 0);
    item(bandY, band).push(ys[i] ?? 0);
  }

  const lines: DetectedLine[] = [];
  for (let b = 0; b < peaks.length; b += 1) {
    const px = Float64Array.from(item(bandX, b)).toSorted();
    const py = Float64Array.from(item(bandY, b)).toSorted();
    if (px.length < MIN_BAND_PIXELS) continue;
    const [first, last] = isolatedEnds(px, pitch * ISOLATED_GAP);
    const kept = px.subarray(first, last + 1);
    const x0 = Math.floor(percentile(kept, EDGE_TRIM));
    const x1 = Math.ceil(percentile(kept, 1 - EDGE_TRIM)) + 1;
    const [rowFirst, rowLast] = isolatedEnds(py, pitch * ISOLATED_ROW_GAP);
    const rows = py.subarray(rowFirst, rowLast + 1);
    const y0 = Math.floor(percentile(rows, EDGE_TRIM));
    const y1 = Math.ceil(percentile(rows, 1 - EDGE_TRIM)) + 1;
    lines.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, inkCount: px.length });
  }
  return { lines, pitch };
}
