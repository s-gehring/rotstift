export function gaussianSmooth(values: ArrayLike<number>, sigma: number): Float64Array {
  const length = values.length;
  const out = new Float64Array(length);
  if (sigma < 0.3) {
    for (let i = 0; i < length; i += 1) out[i] = values[i] ?? 0;
    return out;
  }
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k += 1) {
    const weight = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = weight;
    total += weight;
  }
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const j = i + k;
      if (j >= 0 && j < length) sum += (values[j] ?? 0) * (kernel[k + radius] ?? 0);
    }
    out[i] = sum / total;
  }
  return out;
}

export function item<T>(items: ArrayLike<T>, index: number): T {
  const value = items[index];
  if (value === undefined) throw new RangeError(`index ${index} is out of range`);
  return value;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

export function percentile(sorted: ArrayLike<number>, fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = Math.min(sorted.length - 1, Math.max(0, fraction * (sorted.length - 1)));
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const a = sorted[low] ?? 0;
  const b = sorted[high] ?? a;
  return a + (b - a) * (position - low);
}

export function autocorrelation(values: ArrayLike<number>, maxLag: number): Float64Array {
  const length = values.length;
  let mean = 0;
  for (let i = 0; i < length; i += 1) mean += values[i] ?? 0;
  mean /= Math.max(1, length);
  const centered = new Float64Array(length);
  let energy = 0;
  for (let i = 0; i < length; i += 1) {
    const value = (values[i] ?? 0) - mean;
    centered[i] = value;
    energy += value * value;
  }
  const out = new Float64Array(maxLag + 1);
  if (energy === 0) return out;
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < length; i += 1) sum += (centered[i] ?? 0) * (centered[i + lag] ?? 0);
    out[lag] = sum / energy;
  }
  return out;
}
