import { labelComponents, type Components, type InkMask } from './ink.ts';
import { gaussianSmooth, item, median } from './signal.ts';
import type { BBox, GrayImage, Point, RgbaImage, RuleLine, Ruling } from './types.ts';

const MIN_RESPONSE = 8;
const MAX_ANGLE_DEGREES = 10;
const ANGLE_SAMPLES = 60_000;
const STRIP_LENGTH = 36;
const MIN_STRIPS = 8;
const MAX_STRIPS = 40;
const PEAK_COVERAGE = 0.4;
const TRACK_SLACK = 2;
const TRACK_SPREAD = 0.035;
const MAX_GAP = 3;
const SLOPE_POINTS = 4;
const MAX_BEND = 0.12;
const MIN_SPAN_SHARE = 0.2;
const MIN_SPAN = 4;
const MIN_FILL = 0.6;
const MIN_COVER = 0.55;
const SOLID_COVER = 0.8;
const MIN_SOLID = 3;
const SOLID_SHARE = 0.25;
const MIN_RULES = 5;
const PITCH_TOLERANCE = 0.3;
const REGULAR_SHARE = 0.6;
const CROWDED = 0.6;
const GRID_RATIO = 1.67;
const MARGIN_SPAN = 0.35;
const MARGIN_ZONE = 0.45;
const TINT_GAP = 20;
const MARGIN_LENGTH = 1.25;
const ERASE_REACH = 1.5;
const LINE_EDGE = [0.25, 0.5];
const SEARCH = 2;
const POSITION_WINDOW = 10;
const CONTRAST_BLOCK = 12;
const INK_CONTRAST = 1.35;

export const BLANK: Ruling = {
  kind: 'blank',
  horizontal: [],
  vertical: [],
  pitch: 0,
  columnPitch: 0,
  angleDegrees: 0,
  margins: { left: null, right: null },
};

interface Frame {
  readonly along: number;
  readonly across: number;
  readonly alongStride: number;
  readonly acrossStride: number;
}

function frameOf(gray: GrayImage, vertical: boolean): Frame {
  return vertical
    ? { along: gray.height, across: gray.width, alongStride: gray.width, acrossStride: 1 }
    : { along: gray.width, across: gray.height, alongStride: 1, acrossStride: gray.width };
}

function responseAt(data: Uint8Array, index: number, stride: number): number {
  const value = data[index] ?? 255;
  const near = Math.min(data[index - 2 * stride] ?? 0, data[index + 2 * stride] ?? 0);
  const far = Math.min(data[index - 3 * stride] ?? 0, data[index + 3 * stride] ?? 0);
  return Math.max(0, near - value, far - value);
}

interface Thin {
  readonly along: Int32Array;
  readonly across: Int32Array;
}

function thinLines(gray: GrayImage, frame: Frame, response: Int16Array): Thin {
  const { data } = gray;
  const { along, across, alongStride, acrossStride } = frame;
  response.fill(0);
  for (let c = 3; c < across - 3; c += 1) {
    for (let a = 0; a < along; a += 1) {
      const index = a * alongStride + c * acrossStride;
      response[index] = responseAt(data, index, acrossStride);
    }
  }
  const as: number[] = [];
  const cs: number[] = [];
  for (let c = 4; c < across - 4; c += 1) {
    for (let a = 0; a < along; a += 1) {
      const index = a * alongStride + c * acrossStride;
      const value = response[index] ?? 0;
      if (value < MIN_RESPONSE) continue;
      if (value < (response[index - acrossStride] ?? 0)) continue;
      if (value <= (response[index + acrossStride] ?? 0)) continue;
      as.push(a);
      cs.push(c);
    }
  }
  return { along: Int32Array.from(as), across: Int32Array.from(cs) };
}

function sharpness(thin: Thin, tan: number, across: number, along: number, every: number) {
  const offset = Math.ceil(along * Math.abs(tan)) + 1;
  const histogram = new Int32Array(across + offset * 2 + 1);
  for (let i = 0; i < thin.along.length; i += every) {
    const bin = (thin.across[i] ?? 0) - Math.round((thin.along[i] ?? 0) * tan) + offset;
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }
  const smooth = gaussianSmooth(histogram, 1);
  let energy = 0;
  for (let i = 1; i < smooth.length; i += 1) {
    const diff = (smooth[i] ?? 0) - (smooth[i - 1] ?? 0);
    energy += diff * diff;
  }
  return energy;
}

function toTan(degrees: number): number {
  return Math.tan((degrees * Math.PI) / 180);
}

function dominantTangent(thin: Thin, frame: Frame): number {
  if (thin.along.length < 50) return 0;
  const every = Math.max(1, Math.ceil(thin.along.length / ANGLE_SAMPLES));
  let best = 0;
  let bestEnergy = -1;
  const probe = (degrees: number) => {
    const energy = sharpness(thin, toTan(degrees), frame.across, frame.along, every);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      best = degrees;
    }
  };
  for (let degrees = -MAX_ANGLE_DEGREES; degrees <= MAX_ANGLE_DEGREES + 1e-9; degrees += 1) {
    probe(degrees);
  }
  const center = best;
  for (let degrees = center - 0.9; degrees <= center + 0.9 + 1e-9; degrees += 0.1) probe(degrees);
  return toTan(best);
}

interface Peak {
  readonly position: number;
  readonly cover: number;
}

interface Chain {
  readonly strips: number[];
  readonly positions: number[];
  readonly covers: number[];
}

function stripPeaks(thin: Thin, frame: Frame, tan: number, strips: number): Peak[][] {
  const step = frame.along / strips;
  const offset = Math.ceil(step * Math.abs(tan)) + 3;
  const bins = frame.across + offset * 2;
  const counts = new Int32Array(strips * bins);
  for (let i = 0; i < thin.along.length; i += 1) {
    const a = thin.along[i] ?? 0;
    const strip = Math.min(strips - 1, Math.floor(a / step));
    const center = (strip + 0.5) * step;
    const bin = (thin.across[i] ?? 0) - Math.round((a - center) * tan) + offset;
    if (bin >= 0 && bin < bins) counts[strip * bins + bin] = (counts[strip * bins + bin] ?? 0) + 1;
  }
  const result: Peak[][] = [];
  const cover = new Float64Array(bins);
  for (let strip = 0; strip < strips; strip += 1) {
    const base = strip * bins;
    for (let b = 1; b + 1 < bins; b += 1) {
      cover[b] =
        ((counts[base + b - 1] ?? 0) + (counts[base + b] ?? 0) + (counts[base + b + 1] ?? 0)) /
        step;
    }
    const peaks: Peak[] = [];
    for (let b = 2; b + 2 < bins; b += 1) {
      const value = cover[b] ?? 0;
      if (value < PEAK_COVERAGE) continue;
      if (
        value <= (cover[b - 1] ?? 0) ||
        value <= (cover[b - 2] ?? 0) ||
        value < (cover[b + 1] ?? 0) ||
        value < (cover[b + 2] ?? 0)
      ) {
        continue;
      }
      const left = counts[base + b - 1] ?? 0;
      const middle = counts[base + b] ?? 0;
      const right = counts[base + b + 1] ?? 0;
      const mass = left + middle + right;
      const centroid = mass > 0 ? b + (right - left) / mass : b;
      peaks.push({ position: centroid - offset, cover: Math.min(1, value) });
    }
    result.push(peaks);
  }
  return result;
}

function slopeOf(chain: Chain, step: number, tan: number): number {
  const count = chain.strips.length;
  const from = Math.max(0, count - SLOPE_POINTS);
  if (count - from < 2) return tan;
  let meanS = 0;
  let meanP = 0;
  for (let i = from; i < count; i += 1) {
    meanS += item(chain.strips, i);
    meanP += item(chain.positions, i);
  }
  meanS /= count - from;
  meanP /= count - from;
  let covariance = 0;
  let variance = 0;
  for (let i = from; i < count; i += 1) {
    const ds = item(chain.strips, i) - meanS;
    covariance += ds * (item(chain.positions, i) - meanP);
    variance += ds * ds;
  }
  if (variance <= 0) return tan;
  const slope = covariance / variance / step;
  return Math.max(tan - MAX_BEND, Math.min(tan + MAX_BEND, slope));
}

function trackChains(peaksPerStrip: readonly (readonly Peak[])[], step: number, tan: number) {
  const finished: Chain[] = [];
  let active: Chain[] = [];
  peaksPerStrip.forEach((peaks, strip) => {
    const pairs: { chain: number; peak: number; distance: number }[] = [];
    active.forEach((chain, c) => {
      const last = chain.strips.length - 1;
      const gap = strip - item(chain.strips, last);
      const predicted = item(chain.positions, last) + slopeOf(chain, step, tan) * gap * step;
      const tolerance = TRACK_SLACK + TRACK_SPREAD * gap * step;
      peaks.forEach((peak, p) => {
        const distance = Math.abs(peak.position - predicted);
        if (distance <= tolerance) pairs.push({ chain: c, peak: p, distance });
      });
    });
    pairs.sort((x, y) => x.distance - y.distance);
    const usedChains = new Set<number>();
    const usedPeaks = new Set<number>();
    for (const pair of pairs) {
      if (usedChains.has(pair.chain) || usedPeaks.has(pair.peak)) continue;
      usedChains.add(pair.chain);
      usedPeaks.add(pair.peak);
      const chain = item(active, pair.chain);
      const peak = item(peaks, pair.peak);
      chain.strips.push(strip);
      chain.positions.push(peak.position);
      chain.covers.push(peak.cover);
    }
    const next: Chain[] = [];
    for (const chain of active) {
      if (strip - item(chain.strips, chain.strips.length - 1) > MAX_GAP) finished.push(chain);
      else next.push(chain);
    }
    peaks.forEach((peak, p) => {
      if (!usedPeaks.has(p)) {
        next.push({ strips: [strip], positions: [peak.position], covers: [peak.cover] });
      }
    });
    active = next;
  });
  return [...finished, ...active];
}

function span(chain: Chain): number {
  return item(chain.strips, chain.strips.length - 1) - item(chain.strips, 0) + 1;
}

function meanCover(chain: Chain): number {
  return chain.covers.reduce((sum, value) => sum + value, 0) / chain.covers.length;
}

function isLong(chain: Chain, strips: number): boolean {
  const length = span(chain);
  const solid = chain.covers.filter((cover) => cover >= SOLID_COVER).length;
  return (
    length >= Math.max(MIN_SPAN, Math.ceil(strips * MIN_SPAN_SHARE)) &&
    chain.strips.length / length >= MIN_FILL &&
    meanCover(chain) >= MIN_COVER &&
    solid >= Math.max(MIN_SOLID, chain.strips.length * SOLID_SHARE)
  );
}

function positionAt(chain: Chain, strip: number): number | null {
  const first = item(chain.strips, 0);
  const last = item(chain.strips, chain.strips.length - 1);
  if (strip < first || strip > last) return null;
  for (let k = 0; k < chain.strips.length; k += 1) {
    const s = item(chain.strips, k);
    if (s === strip) return item(chain.positions, k);
    if (s > strip) {
      const s0 = item(chain.strips, k - 1);
      const p0 = item(chain.positions, k - 1);
      return p0 + ((item(chain.positions, k) - p0) * (strip - s0)) / (s - s0);
    }
  }
  return null;
}

function stripGaps(chains: readonly Chain[], strips: number): number[][] {
  const result: number[][] = [];
  for (let strip = 0; strip < strips; strip += 1) {
    const present = chains.flatMap((chain) => {
      const position = positionAt(chain, strip);
      return position === null ? [] : [position];
    });
    present.sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let k = 1; k < present.length; k += 1) gaps.push(item(present, k) - item(present, k - 1));
    result.push(gaps);
  }
  return result;
}

function dropCrowded(chains: readonly Chain[], strips: number): Chain[] {
  let kept = [...chains];
  for (let round = 0; round < 3; round += 1) {
    const pitch = median(stripGaps(kept, strips).flat());
    if (!(pitch > 0)) return kept;
    const votes = new Map<Chain, number>();
    for (let strip = 0; strip < strips; strip += 1) {
      const present = kept
        .flatMap((chain) => {
          const position = positionAt(chain, strip);
          return position === null ? [] : [{ chain, position }];
        })
        .toSorted((a, b) => a.position - b.position);
      for (let k = 1; k < present.length; k += 1) {
        const upper = item(present, k - 1);
        const lower = item(present, k);
        if (lower.position - upper.position >= pitch * CROWDED) continue;
        const weaker = meanCover(upper.chain) < meanCover(lower.chain) ? upper : lower;
        votes.set(weaker.chain, (votes.get(weaker.chain) ?? 0) + 1);
      }
    }
    const before = kept.length;
    kept = kept.filter((chain) => (votes.get(chain) ?? 0) < span(chain) * 0.5);
    if (kept.length === before) break;
  }
  return kept;
}

interface Family {
  readonly chains: readonly Chain[];
  readonly pitch: number;
  readonly regular: boolean;
}

function family(chains: readonly Chain[], strips: number): Family {
  const kept = dropCrowded(chains, strips);
  const gaps = stripGaps(kept, strips).flat();
  const pitch = median(gaps);
  if (kept.length < MIN_RULES || !(pitch > 0)) return { chains: kept, pitch, regular: false };
  const fits = gaps.filter((gap) =>
    [1, 2].some((k) => Math.abs(gap - k * pitch) <= pitch * PITCH_TOLERANCE),
  ).length;
  return { chains: kept, pitch, regular: fits >= gaps.length * REGULAR_SHARE };
}

interface Oriented {
  readonly frame: Frame;
  readonly tan: number;
  readonly strips: number;
  readonly step: number;
  readonly long: readonly Chain[];
  readonly family: Family;
}

function orient(gray: GrayImage, vertical: boolean, response: Int16Array): Oriented {
  const frame = frameOf(gray, vertical);
  const thin = thinLines(gray, frame, response);
  const tan = dominantTangent(thin, frame);
  const strips = Math.min(MAX_STRIPS, Math.max(MIN_STRIPS, Math.round(frame.along / STRIP_LENGTH)));
  const step = frame.along / strips;
  const chains = trackChains(stripPeaks(thin, frame, tan, strips), step, tan);
  const long = chains.filter((chain) => isLong(chain, strips));
  return { frame, tan, strips, step, long, family: family(long, strips) };
}

function toLine(chain: Chain, oriented: Oriented, vertical: boolean): RuleLine {
  const { step, tan } = oriented;
  const point = (along: number, across: number): Point =>
    vertical ? { x: across, y: along } : { x: along, y: across };
  const firstStrip = item(chain.strips, 0);
  const lastStrip = item(chain.strips, chain.strips.length - 1);
  const points: Point[] = [point(firstStrip * step, item(chain.positions, 0) - (step / 2) * tan)];
  chain.strips.forEach((strip, k) => {
    points.push(point((strip + 0.5) * step, item(chain.positions, k)));
  });
  points.push(
    point(
      (lastStrip + 1) * step,
      item(chain.positions, chain.positions.length - 1) + (step / 2) * tan,
    ),
  );
  return { points };
}

function middleAcross(chain: Chain): number {
  return median(chain.positions);
}

function tint(image: RgbaImage | undefined, line: RuleLine, scale: number): number | null {
  if (image === undefined) return null;
  const { width, height, data } = image;
  const values: number[] = [];
  const reach = Math.max(2, Math.round(2 / scale));
  for (let k = 0; k + 1 < line.points.length; k += 1) {
    const from = item(line.points, k);
    const to = item(line.points, k + 1);
    const samples = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 4));
    for (let s = 0; s < samples; s += 1) {
      const x = Math.round((from.x + ((to.x - from.x) * s) / samples) / scale);
      const y = Math.round((from.y + ((to.y - from.y) * s) / samples) / scale);
      if (y < 0 || y >= height) continue;
      let darkest = 256;
      let red = 0;
      for (let dx = -reach; dx <= reach; dx += 1) {
        const px = x + dx;
        if (px < 0 || px >= width) continue;
        const at = (y * width + px) * 4;
        const r = data[at] ?? 0;
        const g = data[at + 1] ?? 0;
        const b = data[at + 2] ?? 0;
        const luma = (r * 77 + g * 150 + b * 29) >> 8;
        if (luma < darkest) {
          darkest = luma;
          red = r - (g + b) / 2;
        }
      }
      if (darkest < 256) values.push(red);
    }
  }
  return values.length === 0 ? null : median(values);
}

function findMargins(
  vertical: Oriented,
  columns: readonly Chain[],
  extent: readonly [number, number],
  image: RgbaImage | undefined,
  scale: number,
): { left: Chain | null; right: Chain | null } {
  const minSpan = Math.ceil(vertical.strips * MARGIN_SPAN);
  const candidates = vertical.long.filter((chain) => span(chain) >= minSpan);
  const columnTint = median(
    columns.flatMap((chain) => {
      const value = tint(image, toLine(chain, vertical, true), scale);
      return value === null ? [] : [value];
    }),
  );
  const columnSpan = median(columns.map(span));
  const special = candidates.filter((chain) => {
    if (columns.length === 0 || !columns.includes(chain)) return true;
    const value = tint(image, toLine(chain, vertical, true), scale);
    if (value !== null && Math.abs(value - columnTint) >= TINT_GAP) return true;
    return span(chain) >= columnSpan * MARGIN_LENGTH;
  });
  const [x0, x1] = extent;
  const zone = (x1 - x0) * MARGIN_ZONE;
  const longest = (chains: readonly Chain[]) =>
    chains.reduce<Chain | null>(
      (best, chain) => (best === null || span(chain) > span(best) ? chain : best),
      null,
    );
  return {
    left: longest(special.filter((chain) => middleAcross(chain) < x0 + zone)),
    right: longest(special.filter((chain) => middleAcross(chain) > x1 - zone)),
  };
}

function alongExtent(oriented: Oriented, chains: readonly Chain[]): [number, number] {
  if (chains.length === 0) return [0, oriented.frame.along];
  const starts = chains.map((chain) => item(chain.strips, 0) * oriented.step);
  const ends = chains.map(
    (chain) => (item(chain.strips, chain.strips.length - 1) + 1) * oriented.step,
  );
  return [median(starts), median(ends)];
}

function byAcross(a: Chain, b: Chain): number {
  return middleAcross(a) - middleAcross(b);
}

export function findRuling(gray: GrayImage, image?: RgbaImage): Ruling {
  const response = new Int16Array(gray.width * gray.height);
  const horizontal = orient(gray, false, response);
  const vertical = orient(gray, true, response);
  const lined = horizontal.family.regular;
  const ratio = vertical.family.pitch / Math.max(1e-9, horizontal.family.pitch);
  const grid = lined && vertical.family.regular && ratio <= GRID_RATIO && ratio >= 1 / GRID_RATIO;
  const rows = lined ? horizontal.family.chains : [];
  const columns = grid ? vertical.family.chains : [];
  const extent: [number, number] = lined ? alongExtent(horizontal, rows) : [0, gray.width];
  const margins = findMargins(vertical, columns, extent, image, gray.scale);
  const marginChains = new Set([margins.left, margins.right]);
  return {
    kind: grid ? 'grid' : lined ? 'lined' : 'blank',
    horizontal: rows.toSorted(byAcross).map((chain) => toLine(chain, horizontal, false)),
    vertical: columns
      .filter((chain) => !marginChains.has(chain))
      .toSorted(byAcross)
      .map((chain) => toLine(chain, vertical, true)),
    pitch: lined ? horizontal.family.pitch : 0,
    columnPitch: grid ? vertical.family.pitch : 0,
    angleDegrees: lined ? (Math.atan(horizontal.tan) * 180) / Math.PI : 0,
    margins: {
      left: margins.left === null ? null : toLine(margins.left, vertical, true),
      right: margins.right === null ? null : toLine(margins.right, vertical, true),
    },
  };
}

function scaleLine(line: RuleLine, factor: number): RuleLine {
  return { points: line.points.map((point) => ({ x: point.x * factor, y: point.y * factor })) };
}

export function scaleRuling(ruling: Ruling, factor: number): Ruling {
  return {
    ...ruling,
    horizontal: ruling.horizontal.map((line) => scaleLine(line, factor)),
    vertical: ruling.vertical.map((line) => scaleLine(line, factor)),
    pitch: ruling.pitch * factor,
    columnPitch: ruling.columnPitch * factor,
    margins: {
      left: ruling.margins.left === null ? null : scaleLine(ruling.margins.left, factor),
      right: ruling.margins.right === null ? null : scaleLine(ruling.margins.right, factor),
    },
  };
}

function traceGuesses(line: RuleLine, vertical: boolean, frame: Frame): Int32Array {
  const guesses = new Int32Array(frame.along).fill(-1);
  const along = (point: Point) => (vertical ? point.y : point.x);
  const across = (point: Point) => (vertical ? point.x : point.y);
  for (let k = 0; k + 1 < line.points.length; k += 1) {
    const from = item(line.points, k);
    const to = item(line.points, k + 1);
    const a0 = Math.max(0, Math.ceil(along(from)));
    const a1 = Math.min(frame.along - 1, Math.floor(along(to)));
    const length = along(to) - along(from);
    for (let a = a0; a <= a1; a += 1) {
      const share = length > 0 ? (a - along(from)) / length : 0;
      const guess = Math.round(across(from) + (across(to) - across(from)) * share);
      if (guess >= 3 + SEARCH && guess < frame.across - 3 - SEARCH) guesses[a] = guess;
    }
  }
  return guesses;
}

function eraseLine(mask: InkMask, gray: GrayImage, line: RuleLine, vertical: boolean): void {
  const frame = frameOf(gray, vertical);
  const { alongStride, acrossStride } = frame;
  const { data } = gray;
  const guesses = traceGuesses(line, vertical, frame);
  const offsets = new Int8Array(frame.along).fill(-128);
  const contrasts = new Float32Array(frame.along).fill(-1);
  const paperAt = (center: number) =>
    Math.max(data[center - 3 * acrossStride] ?? 0, data[center + 3 * acrossStride] ?? 0);
  for (let a = 0; a < frame.along; a += 1) {
    const guess = guesses[a] ?? -1;
    if (guess < 0) continue;
    let best = -1;
    let bestOffset = 0;
    for (let offset = -SEARCH; offset <= SEARCH; offset += 1) {
      const value = responseAt(
        data,
        a * alongStride + (guess + offset) * acrossStride,
        acrossStride,
      );
      if (value > best) {
        best = value;
        bestOffset = offset;
      }
    }
    if (best < MIN_RESPONSE) continue;
    offsets[a] = bestOffset;
    const center = a * alongStride + (guess + bestOffset) * acrossStride;
    contrasts[a] = paperAt(center) - (data[center] ?? 0);
  }
  const typical = new Float32Array(frame.along);
  for (let block = 0; block < frame.along; block += CONTRAST_BLOCK) {
    const values: number[] = [];
    const from = Math.max(0, block - CONTRAST_BLOCK);
    const to = Math.min(frame.along, block + 2 * CONTRAST_BLOCK);
    for (let a = from; a < to; a += 1) {
      const value = contrasts[a] ?? -1;
      if (value >= 0) values.push(value);
    }
    const level = values.length > 0 ? median(values) : 0;
    typical.fill(level, block, Math.min(frame.along, block + CONTRAST_BLOCK));
  }
  const histogram = new Int32Array(2 * SEARCH + 1);
  let counted = 0;
  const shift = (a: number, sign: number) => {
    const offset = offsets[a] ?? -128;
    if (offset === -128) return;
    histogram[offset + SEARCH] = (histogram[offset + SEARCH] ?? 0) + sign;
    counted += sign;
  };
  for (let a = 0; a < Math.min(frame.along, POSITION_WINDOW); a += 1) shift(a, 1);
  for (let a = 0; a < frame.along; a += 1) {
    if (a + POSITION_WINDOW < frame.along) shift(a + POSITION_WINDOW, 1);
    if (a - POSITION_WINDOW - 1 >= 0) shift(a - POSITION_WINDOW - 1, -1);
    const guess = guesses[a] ?? -1;
    const contrast = typical[a] ?? 0;
    if (guess < 0 || counted === 0 || contrast <= 0) continue;
    let offset = -SEARCH;
    let seen = histogram[0] ?? 0;
    while (seen * 2 < counted && offset < SEARCH) {
      offset += 1;
      seen += histogram[offset + SEARCH] ?? 0;
    }
    const center = a * alongStride + (guess + offset) * acrossStride;
    const paper = paperAt(center);
    const ink = paper - contrast * INK_CONTRAST;
    if ((data[center] ?? 0) < ink) continue;
    mask.data[center] = 0;
    for (const side of [-1, 1]) {
      for (let d = 1; d <= LINE_EDGE.length; d += 1) {
        const index = center + side * d * acrossStride;
        const value = data[index] ?? 255;
        if (value < ink || value > paper - contrast * (LINE_EDGE[d - 1] ?? 1)) break;
        mask.data[index] = 0;
      }
    }
  }
}

function stretch(from: Point, to: Point, reach: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return to;
  return {
    x: to.x + ((to.x - from.x) * reach) / length,
    y: to.y + ((to.y - from.y) * reach) / length,
  };
}

function extended(line: RuleLine, before: number, after: number): RuleLine {
  const { points } = line;
  if (points.length < 2) return line;
  return {
    points: [
      stretch(item(points, 1), item(points, 0), before),
      ...points,
      stretch(item(points, points.length - 2), item(points, points.length - 1), after),
    ],
  };
}

export function eraseRuling(mask: InkMask, gray: GrayImage, ruling: Ruling): void {
  const reach = Math.max(ruling.pitch, ruling.columnPitch) * ERASE_REACH;
  if (ruling.horizontal.length > 0) {
    const left = edgeLine(ruling, 0, 0);
    const right = edgeLine(ruling, 1, 0);
    for (const line of ruling.horizontal) {
      const first = item(line.points, 0);
      const last = item(line.points, line.points.length - 1);
      const before = Math.max(0, first.x - left(first.y)) + reach;
      const after = Math.max(0, right(last.y) - last.x) + reach;
      eraseLine(mask, gray, extended(line, before, after), false);
    }
  }
  for (const line of ruling.vertical) eraseLine(mask, gray, extended(line, reach, reach), true);
  for (const line of [ruling.margins.left, ruling.margins.right]) {
    if (line !== null) eraseLine(mask, gray, extended(line, reach, reach), true);
  }
}

const BINDING_SIZE = 2;
const BINDING_ZONE = 1;
const BINDING_BANDS = [1, 0.75];
const MIN_BINDING_ROWS = 6;
const BINDING_TOLERANCE = 0.35;
const BINDING_SAME_ROW = 0.3;
const BINDING_AREA_SPREAD = 0.4;
const BINDING_MAIN_ROW = 0.3;
const REMNANT_HEIGHT = 0.15;
const REMNANT_RATIO = 3;
const REGION_REACH = 1.5;
const SLIVER_WIDTH = 0.2;
const SLIVER_RATIO = 3;
const BINDING_COLUMNS = 2;
const BINDING_NEIGHBOUR = 1.5;

interface Column {
  readonly members: number[];
  readonly offset: number;
  readonly slope: number;
}

function acrossAt(line: RuleLine, along: number, vertical: boolean): number {
  const points = line.points;
  const key = (point: Point) => (vertical ? point.y : point.x);
  const value = (point: Point) => (vertical ? point.x : point.y);
  const first = item(points, 0);
  if (along <= key(first)) return value(first);
  for (let k = 1; k < points.length; k += 1) {
    const right = item(points, k);
    if (along <= key(right)) {
      const left = item(points, k - 1);
      const length = key(right) - key(left);
      return length > 0
        ? value(left) + ((value(right) - value(left)) * (along - key(left))) / length
        : value(right);
    }
  }
  return value(item(points, points.length - 1));
}

function edgeLine(ruling: Ruling, side: 0 | 1, zone = BINDING_ZONE): (y: number) => number {
  const margin = side === 0 ? ruling.margins.left : ruling.margins.right;
  if (margin !== null) return (y) => acrossAt(margin, y, true);
  const ends = ruling.horizontal.map((line) =>
    side === 0 ? item(line.points, 0) : item(line.points, line.points.length - 1),
  );
  let kept = ends;
  let slope = 0;
  let offset = median(ends.map((point) => point.x));
  for (let round = 0; round < 3; round += 1) {
    slope = fitSlope(
      kept.map((point) => point.y),
      kept.map((point) => point.x),
      slope,
    );
    offset = median(kept.map((point) => point.x - slope * point.y));
    const next = ends.filter(
      (point) => Math.abs(point.x - slope * point.y - offset) <= ruling.pitch,
    );
    if (next.length < MIN_BINDING_ROWS) break;
    kept = next;
  }
  const inward = (side === 0 ? 1 : -1) * ruling.pitch * zone;
  return (y) => offset + slope * y + inward;
}

export function insideRuling(ruling: Ruling, box: BBox): boolean {
  if (ruling.horizontal.length === 0) return true;
  const reach = ruling.pitch * REGION_REACH;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const first = acrossAt(item(ruling.horizontal, 0), cx, false);
  const last = acrossAt(item(ruling.horizontal, ruling.horizontal.length - 1), cx, false);
  if (box.y + box.height < first - reach || box.y > last + reach) return false;
  const left = edgeLine(ruling, 0, 0)(cy);
  const right = edgeLine(ruling, 1, 0)(cy);
  return box.x + box.width >= left - reach && box.x <= right + reach;
}

function spread(values: readonly number[]): number {
  const middle = median(values);
  return middle > 0 ? median(values.map((value) => Math.abs(value - middle))) / middle : Infinity;
}

function fitSlope(ys: readonly number[], xs: readonly number[], fallback: number): number {
  if (ys.length < MIN_BINDING_ROWS) return fallback;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  let covariance = 0;
  let variance = 0;
  ys.forEach((y, k) => {
    covariance += (y - meanY) * (item(xs, k) - meanX);
    variance += (y - meanY) ** 2;
  });
  return variance > 0 ? covariance / variance : fallback;
}

function bindingColumn(
  components: Components,
  all: readonly number[],
  ruling: Ruling,
  beside: Column | null,
): Column | null {
  const pitch = ruling.pitch;
  const centerX = (label: number) =>
    ((components.minX[label] ?? 0) + (components.maxX[label] ?? 0)) / 2;
  const centerY = (label: number) =>
    ((components.minY[label] ?? 0) + (components.maxY[label] ?? 0)) / 2;
  const candidates =
    beside === null
      ? all
      : all.filter(
          (label) =>
            Math.abs(centerX(label) - beside.slope * centerY(label) - beside.offset) <=
            pitch * BINDING_NEIGHBOUR,
        );
  if (candidates.length < MIN_BINDING_ROWS) return null;
  let slope = beside?.slope ?? -Math.tan((ruling.angleDegrees * Math.PI) / 180);
  let members: number[] = [];
  let offset = 0;
  for (const band of BINDING_BANDS) {
    const residual = (label: number) => centerX(label) - slope * centerY(label);
    offset = median((members.length > 0 ? members : candidates).map(residual));
    members = candidates
      .filter((label) => Math.abs(residual(label) - offset) <= pitch * band)
      .toSorted((a, b) => centerY(a) - centerY(b));
    slope = fitSlope(members.map(centerY), members.map(centerX), slope);
  }
  const grouped: { y: number; area: number }[] = [];
  for (const label of members) {
    const y = centerY(label);
    const area = components.area[label] ?? 0;
    const last = grouped[grouped.length - 1];
    if (last !== undefined && y - last.y <= pitch * BINDING_SAME_ROW) last.area += area;
    else grouped.push({ y, area });
  }
  const mainArea = median(grouped.map((row) => row.area)) * BINDING_MAIN_ROW;
  const rows = grouped.filter((row) => row.area >= mainArea);
  if (rows.length < MIN_BINDING_ROWS) return null;
  const gaps: number[] = [];
  for (let k = 1; k < rows.length; k += 1) gaps.push(item(rows, k).y - item(rows, k - 1).y);
  const typical = median(gaps);
  const regular = gaps.filter((gap) =>
    [1, 2].some((k) => Math.abs(gap - k * typical) <= typical * BINDING_TOLERANCE),
  ).length;
  if (regular < gaps.length * REGULAR_SHARE) return null;
  const areas = rows.map((row) => row.area);
  const paired = (start: number) => {
    const sums: number[] = [];
    for (let k = start; k + 1 < areas.length; k += 2)
      sums.push(item(areas, k) + item(areas, k + 1));
    return spread(sums);
  };
  if (Math.min(spread(areas), paired(0), paired(1)) > BINDING_AREA_SPREAD) return null;
  return { members, offset, slope };
}

export function eraseBinding(mask: InkMask, ruling: Ruling): void {
  const pitch = ruling.pitch;
  if (ruling.horizontal.length === 0 || !(pitch > 0)) return;
  const components = labelComponents(mask);
  const edges = [edgeLine(ruling, 0), edgeLine(ruling, 1)] as const;
  const ends = [edgeLine(ruling, 0, 0), edgeLine(ruling, 1, 0)] as const;
  const sides: number[][] = [[], []];
  const drop = new Uint8Array(components.count);
  for (let label = 1; label < components.count; label += 1) {
    if ((components.area[label] ?? 0) < 4) continue;
    const width = (components.maxX[label] ?? 0) - (components.minX[label] ?? 0);
    const height = (components.maxY[label] ?? 0) - (components.minY[label] ?? 0);
    if (width > pitch * BINDING_SIZE || height > pitch * BINDING_SIZE) continue;
    if (height <= pitch * REMNANT_HEIGHT && width >= height * REMNANT_RATIO) continue;
    const x = ((components.minX[label] ?? 0) + (components.maxX[label] ?? 0)) / 2;
    const y = ((components.minY[label] ?? 0) + (components.maxY[label] ?? 0)) / 2;
    const beyond = x < ends[0](y) || x > ends[1](y);
    if (beyond && width <= pitch * SLIVER_WIDTH && height >= Math.max(1, width) * SLIVER_RATIO) {
      drop[label] = 1;
      continue;
    }
    if (x < edges[0](y)) sides[0]?.push(label);
    else if (x > edges[1](y)) sides[1]?.push(label);
  }
  for (const side of sides) {
    let beside: Column | null = null;
    for (let round = 0; round < BINDING_COLUMNS; round += 1) {
      const column = bindingColumn(
        components,
        side.filter((label) => drop[label] !== 1),
        ruling,
        beside,
      );
      if (column === null) break;
      for (const label of column.members) drop[label] = 1;
      beside = column;
    }
  }
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i] === 1 && drop[components.labels[i] ?? 0] === 1) mask.data[i] = 0;
  }
}
