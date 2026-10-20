import type { GrayImage } from './types.ts';

export interface InkMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const MIN_CONTRAST = 22;
const RELATIVE_THRESHOLD = 0.88;

export function binarize(gray: GrayImage): InkMask {
  const { width, height, data } = gray;
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += data[y * width + x] ?? 0;
      integral[(y + 1) * stride + x + 1] = (integral[y * stride + x + 1] ?? 0) + rowSum;
    }
  }
  const radius = Math.max(8, Math.round(Math.max(width, height) / 50));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x] ?? 255;
      if (value > 200) continue;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum =
        (integral[y1 * stride + x1] ?? 0) -
        (integral[y0 * stride + x1] ?? 0) -
        (integral[y1 * stride + x0] ?? 0) +
        (integral[y0 * stride + x0] ?? 0);
      const mean = sum / ((x1 - x0) * (y1 - y0));
      if (value <= mean * RELATIVE_THRESHOLD && mean - value >= MIN_CONTRAST) {
        out[y * width + x] = 1;
      }
    }
  }
  return { width, height, data: out };
}

function inkPoints(mask: InkMask, limit: number): { xs: Int32Array; ys: Int32Array } {
  const { width, height, data } = mask;
  let total = 0;
  for (let i = 0; i < data.length; i += 1) total += data[i] ?? 0;
  const step = Math.max(1, Math.ceil(total / limit));
  const xs = new Int32Array(Math.ceil(total / step) + 1);
  const ys = new Int32Array(xs.length);
  let count = 0;
  let seen = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] !== 1) continue;
      seen += 1;
      if (seen % step !== 0) continue;
      xs[count] = x;
      ys[count] = y;
      count += 1;
    }
  }
  return { xs: xs.subarray(0, count), ys: ys.subarray(0, count) };
}

function sharpness(xs: Int32Array, ys: Int32Array, tan: number, height: number, width: number) {
  const offset = Math.ceil(width * Math.abs(tan)) + 1;
  const histogram = new Int32Array(height + offset * 2 + 1);
  for (let i = 0; i < xs.length; i += 1) {
    const bin = (ys[i] ?? 0) - Math.round((xs[i] ?? 0) * tan) + offset;
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }
  let energy = 0;
  for (let i = 1; i < histogram.length; i += 1) {
    const diff = (histogram[i] ?? 0) - (histogram[i - 1] ?? 0);
    energy += diff * diff;
  }
  return energy;
}

export const MAX_SKEW_DEGREES = 6;

function toTan(degrees: number): number {
  return Math.tan((degrees * Math.PI) / 180);
}

export function estimateSkewTangent(mask: InkMask): number {
  const { xs, ys } = inkPoints(mask, 120_000);
  if (xs.length < 50) return 0;
  let best = 0;
  let bestEnergy = -1;
  for (let degrees = -MAX_SKEW_DEGREES; degrees <= MAX_SKEW_DEGREES + 1e-9; degrees += 0.5) {
    const energy = sharpness(xs, ys, toTan(degrees), mask.height, mask.width);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = degrees;
    }
  }
  const center = best;
  for (let degrees = center - 0.5; degrees <= center + 0.5 + 1e-9; degrees += 0.1) {
    const energy = sharpness(xs, ys, toTan(degrees), mask.height, mask.width);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = degrees;
    }
  }
  return toTan(best);
}

const RUN_GAP = 2;
const DENSE_ROW = 0.4;
const THIN_HEIGHT = 4;
const THIN_LENGTH = 30;

function longRunMask(
  data: Uint8Array,
  width: number,
  height: number,
  minLength: number,
  vertical: boolean,
): Uint8Array {
  const marks = new Uint8Array(width * height);
  const lines = vertical ? width : height;
  const length = vertical ? height : width;
  const index = (line: number, position: number) =>
    vertical ? position * width + line : line * width + position;
  const row = new Uint8Array(length);
  for (let line = 0; line < lines; line += 1) {
    for (let position = 0; position < length; position += 1) {
      let ink = data[index(line, position)] === 1;
      if (!ink && line > 0) ink = data[index(line - 1, position)] === 1;
      if (!ink && line + 1 < lines) ink = data[index(line + 1, position)] === 1;
      row[position] = ink ? 1 : 0;
    }
    let start = -1;
    let last = -1;
    for (let position = 0; position <= length; position += 1) {
      const ink = position < length && row[position] === 1;
      if (ink) {
        if (start < 0) start = position;
        last = position;
      }
      if (start >= 0 && (position === length || (!ink && position - last > RUN_GAP))) {
        if (last - start + 1 >= minLength) {
          for (let p = start; p <= last; p += 1) {
            for (let d = -1; d <= 1; d += 1) {
              const neighbour = line + d;
              if (neighbour >= 0 && neighbour < lines) marks[index(neighbour, p)] = 1;
            }
          }
        }
        start = -1;
      }
    }
  }
  return marks;
}

function removeHorizontalRules(mask: InkMask, tan: number): void {
  const { width, height, data } = mask;
  const offset = Math.ceil(width * Math.abs(tan)) + 1;
  const shearedHeight = height + offset * 2;
  const sheared = new Uint8Array(width * shearedHeight);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] !== 1) continue;
      sheared[(y - Math.round(x * tan) + offset) * width + x] = 1;
    }
  }
  const marks = longRunMask(
    sheared,
    width,
    shearedHeight,
    Math.max(40, Math.round(width * 0.12)),
    false,
  );
  const counts = new Int32Array(shearedHeight);
  for (let y = 0; y < shearedHeight; y += 1) {
    for (let x = 0; x < width; x += 1) counts[y] = (counts[y] ?? 0) + (sheared[y * width + x] ?? 0);
  }
  for (let y = 0; y < shearedHeight; y += 1) {
    const count = counts[y] ?? 0;
    if (count < width * DENSE_ROW) continue;
    let around = 0;
    let samples = 0;
    for (const d of [-6, -5, -4, 4, 5, 6]) {
      const neighbour = counts[y + d];
      if (neighbour === undefined) continue;
      around += neighbour;
      samples += 1;
    }
    if (samples > 0 && around / samples > count * 0.5) continue;
    for (let d = -1; d <= 1; d += 1) {
      if (y + d < 0 || y + d >= shearedHeight) continue;
      for (let x = 0; x < width; x += 1) marks[(y + d) * width + x] = 1;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (marks[(y - Math.round(x * tan) + offset) * width + x] === 1) data[y * width + x] = 0;
    }
  }
}

function removeVerticalRules(mask: InkMask, tan: number): void {
  const { width, height, data } = mask;
  const offset = Math.ceil(height * Math.abs(tan)) + 1;
  const shearedWidth = width + offset * 2;
  const sheared = new Uint8Array(shearedWidth * height);
  for (let y = 0; y < height; y += 1) {
    const shift = Math.round(y * tan) + offset;
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] === 1) sheared[y * shearedWidth + x + shift] = 1;
    }
  }
  const marks = longRunMask(
    sheared,
    shearedWidth,
    height,
    Math.max(40, Math.round(height * 0.12)),
    true,
  );
  for (let y = 0; y < height; y += 1) {
    const shift = Math.round(y * tan) + offset;
    for (let x = 0; x < width; x += 1) {
      if (marks[y * shearedWidth + x + shift] === 1) data[y * width + x] = 0;
    }
  }
}

export interface Components {
  readonly labels: Int32Array;
  readonly minX: Int32Array;
  readonly maxX: Int32Array;
  readonly minY: Int32Array;
  readonly maxY: Int32Array;
  readonly area: Int32Array;
  readonly count: number;
}

export function labelComponents(mask: InkMask): Components {
  const { width, height, data } = mask;
  const labels = new Int32Array(width * height);
  const parent: number[] = [0];
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root] ?? root;
    let node = value;
    while (parent[node] !== root) {
      const next = parent[node] ?? root;
      parent[node] = root;
      node = next;
    }
    return root;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (data[at] !== 1) continue;
      const left = x > 0 ? (labels[at - 1] ?? 0) : 0;
      const upLeft = y > 0 && x > 0 ? (labels[at - width - 1] ?? 0) : 0;
      const up = y > 0 ? (labels[at - width] ?? 0) : 0;
      const upRight = y > 0 && x < width - 1 ? (labels[at - width + 1] ?? 0) : 0;
      if (left === 0 && upLeft === 0 && up === 0 && upRight === 0) {
        parent.push(parent.length);
        labels[at] = parent.length - 1;
        continue;
      }
      let root = Number.MAX_SAFE_INTEGER;
      if (left > 0) root = Math.min(root, find(left));
      if (upLeft > 0) root = Math.min(root, find(upLeft));
      if (up > 0) root = Math.min(root, find(up));
      if (upRight > 0) root = Math.min(root, find(upRight));
      labels[at] = root;
      if (left > 0) parent[find(left)] = root;
      if (upLeft > 0) parent[find(upLeft)] = root;
      if (up > 0) parent[find(up)] = root;
      if (upRight > 0) parent[find(upRight)] = root;
    }
  }
  const count = parent.length;
  const minX = new Int32Array(count).fill(width);
  const maxX = new Int32Array(count).fill(-1);
  const minY = new Int32Array(count).fill(height);
  const maxY = new Int32Array(count).fill(-1);
  const area = new Int32Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const raw = labels[y * width + x] ?? 0;
      if (raw === 0) continue;
      const label = find(raw);
      labels[y * width + x] = label;
      if (x < (minX[label] ?? width)) minX[label] = x;
      if (x > (maxX[label] ?? -1)) maxX[label] = x;
      if (y < (minY[label] ?? height)) minY[label] = y;
      if (y > (maxY[label] ?? -1)) maxY[label] = y;
      area[label] = (area[label] ?? 0) + 1;
    }
  }
  return { labels, minX, maxX, minY, maxY, area, count };
}

function removeScannerArtifacts(mask: InkMask): void {
  const { width, height, data } = mask;
  const components = labelComponents(mask);
  const longSide = Math.max(width, height);
  const edge = Math.max(3, Math.round(longSide * 0.02));
  const border = Math.max(2, Math.round(longSide * 0.015));
  const drop = new Uint8Array(components.count);
  for (let label = 1; label < components.count; label += 1) {
    const area = components.area[label] ?? 0;
    if (area === 0) continue;
    const x0 = components.minX[label] ?? 0;
    const x1 = components.maxX[label] ?? 0;
    const y0 = components.minY[label] ?? 0;
    const y1 = components.maxY[label] ?? 0;
    const boxWidth = x1 - x0 + 1;
    const boxHeight = y1 - y0 + 1;
    if (area < 3) {
      drop[label] = 1;
      continue;
    }
    if (
      boxHeight <= THIN_HEIGHT &&
      boxWidth >= THIN_LENGTH &&
      area <= boxWidth * (THIN_HEIGHT - 1)
    ) {
      drop[label] = 1;
      continue;
    }
    if (x1 < border || y1 < border || x0 >= width - border || y0 >= height - border) {
      drop[label] = 1;
      continue;
    }
    const touches = x0 < edge || y0 < edge || x1 >= width - edge || y1 >= height - edge;
    if (!touches) continue;
    const long = Math.max(boxWidth, boxHeight);
    const short = Math.min(boxWidth, boxHeight);
    const fill = area / (boxWidth * boxHeight);
    if (long >= longSide * 0.015 && (long / short >= 6 || (fill >= 0.6 && short >= 6))) {
      drop[label] = 1;
    }
  }
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] === 1 && drop[components.labels[i] ?? 0] === 1) data[i] = 0;
  }
}

const BRIDGE_REACH = 2;

function ruleBridges(before: Uint8Array, mask: InkMask): Uint8Array {
  const { width, height, data } = mask;
  const bridges = new Uint8Array(data);
  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      if (data[y * width + x] === 1 || before[y * width + x] !== 1) {
        y += 1;
        continue;
      }
      const start = y;
      while (y < height && data[y * width + x] !== 1 && before[y * width + x] === 1) y += 1;
      let above = false;
      let below = false;
      for (let d = 1; d <= BRIDGE_REACH; d += 1) {
        if (start - d >= 0 && data[(start - d) * width + x] === 1) above = true;
        if (y - 1 + d < height && data[(y - 1 + d) * width + x] === 1) below = true;
      }
      if (above && below) {
        for (let k = start; k < y; k += 1) bridges[k * width + x] = 1;
      }
    }
  }
  return bridges;
}

export function removeRulesAndArtifacts(mask: InkMask, tan: number): InkMask {
  const before = new Uint8Array(mask.data);
  removeVerticalRules(mask, tan);
  removeHorizontalRules(mask, tan);
  const ruleless = new Uint8Array(mask.data);
  removeScannerArtifacts(mask);
  for (let i = 0; i < ruleless.length; i += 1) {
    if (mask.data[i] !== 1) ruleless[i] = 0;
  }
  return {
    width: mask.width,
    height: mask.height,
    data: ruleBridges(before, { ...mask, data: ruleless }),
  };
}
