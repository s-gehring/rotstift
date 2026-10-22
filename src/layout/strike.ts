import { textUnits } from '../overlay/char-width.ts';
import { toWorkingGray, WORKING_MAX_SIDE } from './gray.ts';
import {
  binarize,
  estimateSkewTangent,
  medianInkContrast,
  MIN_CONTRAST,
  removeRulesAndArtifacts,
  type InkMask,
} from './ink.ts';
import { locateLines } from './locate-lines.ts';
import { eraseBinding, eraseRuling, scaleRuling } from './ruling.ts';
import { readBand, topAt } from './band.ts';
import { item } from './signal.ts';
import type { BBox, GrayImage, Point, RgbaImage, RuleLine, Ruling } from './types.ts';

export interface StrikeOptions {
  readonly minScore: number;
  readonly pageMargin: number;
  readonly wordGap: number;
  readonly share: number;
  readonly wordRatio: number;
}

export const STRIKE_OPTIONS: StrikeOptions = {
  minScore: -1.5,
  pageMargin: 2.05,
  wordGap: 0.5,
  share: 0.6,
  wordRatio: 1.5,
};

export type Span = readonly [number, number];

export interface InkWord {
  readonly x0: number;
  readonly x1: number;
  readonly spans: readonly Span[];
}

export interface Band {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly lift: Int32Array;
}

export interface Core {
  readonly top: number;
  readonly bottom: number;
}

export interface StrokeFeatures {
  readonly length: number;
  readonly crossing: number;
  readonly exact: number;
  readonly height: number;
  readonly thin: number;
  readonly wobble: number;
}

export interface Stroke {
  readonly x0: number;
  readonly x1: number;
  readonly ys: readonly number[];
  readonly features: StrokeFeatures;
  readonly score: number;
}

export interface StrikeLine {
  readonly band: Band;
  readonly core: Core;
  readonly found: readonly Stroke[];
}

export interface StrikeCandidates {
  readonly scale: number;
  readonly lines: readonly (StrikeLine | null)[];
}

const CORE_SHARE = 0.45;
const PATH_TOP = 0.2;
const PATH_BOTTOM = 0.8;
const MIN_LENGTH = 1;
const NEAR = 0.25;
const FAR = 0.6;
const PARALLEL = 3;
const THIN = 4;
const WORKING_SIDE = 1600;
const FINE_MARGIN = 0.45;
const ON_STROKE = 3;
const SPLIT = 1;
const PAGE_QUANTILE = 0.1;
const MIN_PAGE_STROKES = 30;
const MIN_COVER = 0.3;
const MIN_PAGE_LINES = 3;
const MIN_FAINT_CONTRAST = 10;
const FAINT_SHARE = 0.4;

export const STROKE_FEATURES: readonly (keyof StrokeFeatures)[] = [
  'length',
  'crossing',
  'exact',
  'height',
  'thin',
  'wobble',
];

export const STRIKE_WEIGHTS: Readonly<Record<keyof StrokeFeatures | 'bias', number>> = {
  bias: -5.49,
  length: 2.69,
  crossing: 1.04,
  exact: 3.03,
  height: -4.98,
  thin: -3.97,
  wobble: -23.97,
};

function has(mask: InkMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.data[y * mask.width + x] === 1;
}

function rowProfile(clean: InkMask, band: Band): Float64Array {
  const height = band.y1 - band.y0;
  const profile = new Float64Array(height);
  for (let x = band.x0; x < band.x1; x += 1) {
    const shift = band.lift[x - band.x0] ?? 0;
    const before = band.lift[Math.max(0, x - 1 - band.x0)] ?? 0;
    for (let row = 0; row < height; row += 1) {
      if (!has(clean, x, band.y0 + row + shift)) continue;
      if (!has(clean, x - 1, band.y0 + row + before)) profile[row] = (profile[row] ?? 0) + 1;
    }
  }
  return profile;
}

function coreZone(profile: Float64Array, band: Band): Core | null {
  const height = profile.length;
  let peak = 0;
  for (let row = 1; row < height; row += 1) {
    if ((profile[row] ?? 0) > (profile[peak] ?? 0)) peak = row;
  }
  const limit = (profile[peak] ?? 0) * CORE_SHARE;
  if (limit <= 0) return null;
  let top = peak;
  let bottom = peak;
  while (top > 0 && (profile[top - 1] ?? 0) >= limit) top -= 1;
  while (bottom < height - 1 && (profile[bottom + 1] ?? 0) >= limit) bottom += 1;
  return { top: band.y0 + top, bottom: band.y0 + bottom + 1 };
}

function placeCore(profile: Float64Array, band: Band, xHeight: number): Core {
  const size = Math.min(profile.length, Math.max(1, Math.round(xHeight)));
  let sum = 0;
  for (let row = 0; row < size; row += 1) sum += profile[row] ?? 0;
  let best = sum;
  let top = 0;
  for (let row = size; row < profile.length; row += 1) {
    sum += (profile[row] ?? 0) - (profile[row - size] ?? 0);
    if (sum > best) {
      best = sum;
      top = row - size + 1;
    }
  }
  return { top: band.y0 + top, bottom: band.y0 + top + size };
}

function strokeFeatures(
  raw: InkMask,
  clean: InkMask,
  x0: number,
  ys: readonly number[],
  core: Core,
  level: (x: number) => number,
): StrokeFeatures {
  const xHeight = core.bottom - core.top;
  const thinExtent = Math.round((THIN * Math.max(raw.width, raw.height)) / WORKING_MAX_SIDE);
  const near = Math.ceil(NEAR * xHeight);
  const far = Math.ceil(FAR * xHeight);
  const n = ys.length;
  let above = 0;
  let below = 0;
  let exact = 0;
  let thin = 0;
  ys.forEach((y, k) => {
    const x = x0 + k;
    let up = false;
    let down = false;
    for (let dy = near; dy <= far; dy += 1) {
      if (has(clean, x, y - dy)) up = true;
      if (has(clean, x, y + dy)) down = true;
    }
    if (up) above += 1;
    if (down) below += 1;
    if (!has(raw, x, y)) return;
    exact += 1;
    let extent = 1;
    for (let dy = 1; dy <= xHeight && has(raw, x, y - dy); dy += 1) extent += 1;
    for (let dy = 1; dy <= xHeight && has(raw, x, y + dy); dy += 1) extent += 1;
    if (extent <= thinExtent) thin += 1;
  });
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  ys.forEach((y, k) => {
    sxy += (k - meanX) * (y - meanY);
    sxx += (k - meanX) ** 2;
  });
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const wobble =
    Math.sqrt(ys.reduce((sum, y, k) => sum + (y - meanY - slope * (k - meanX)) ** 2, 0) / n) /
    xHeight;
  const middle = (meanY - level(x0 + meanX) - core.top) / xHeight - 0.5;
  return {
    length: Math.log(n / xHeight),
    crossing: Math.min(above, below) / n,
    exact: exact / n,
    height: middle ** 2,
    thin: thin / n,
    wobble,
  };
}

function scoreOf(features: StrokeFeatures): number {
  let score = STRIKE_WEIGHTS.bias;
  for (const key of STROKE_FEATURES) {
    score += STRIKE_WEIGHTS[key] * features[key];
  }
  return score;
}

function strokes(raw: InkMask, clean: InkMask, band: Band, core: Core): Stroke[] {
  const xHeight = core.bottom - core.top;
  const top = Math.round(core.top + PATH_TOP * xHeight);
  const rows = Math.round(core.top + PATH_BOTTOM * xHeight) - top + 1;
  const columns = band.x1 - band.x0;
  if (rows <= 0 || columns <= 0) return [];
  const yAt = (column: number, row: number) => top + row + (band.lift[column] ?? 0);
  const inked = (column: number, row: number) => {
    const x = band.x0 + column;
    const y = yAt(column, row);
    return has(raw, x, y) || has(raw, x, y - 1) || has(raw, x, y + 1);
  };
  const length = new Float64Array(columns * rows);
  const previous = new Int32Array(columns * rows).fill(-1);
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      if (!inked(column, row)) continue;
      let best = 0;
      let from = -1;
      for (let back = 1; back <= 2 && column - back >= 0; back += 1) {
        for (let dy = -back; dy <= back; dy += 1) {
          const at = (column - back) * rows + row + dy;
          if (row + dy < 0 || row + dy >= rows || (length[at] ?? 0) === 0) continue;
          const value = (length[at] ?? 0) - 0.01 * Math.abs(dy) - (back - 1) * 0.5;
          if (value > best) {
            best = value;
            from = at;
          }
        }
      }
      length[column * rows + row] = best + 1;
      previous[column * rows + row] = from;
    }
  }
  const ends: number[] = [];
  for (let at = 0; at < length.length; at += 1) {
    if ((length[at] ?? 0) >= MIN_LENGTH * xHeight) ends.push(at);
  }
  ends.sort((a, b) => (length[b] ?? 0) - (length[a] ?? 0));
  const taken: { from: number; to: number; row: number }[] = [];
  const found: Stroke[] = [];
  for (const end of ends) {
    const cells: number[] = [];
    for (let at = end; at >= 0; at = previous[at] ?? -1) cells.push(at);
    cells.reverse();
    const from = Math.floor((cells[0] ?? 0) / rows);
    const to = Math.floor((cells.at(-1) ?? 0) / rows);
    const row = cells.reduce((sum, cell) => sum + (cell % rows), 0) / cells.length;
    const clash = taken.some(
      (other) =>
        Math.min(other.to, to) - Math.max(other.from, from) > 0.3 * (to - from + 1) &&
        Math.abs(other.row - row) < PARALLEL,
    );
    if (clash) continue;
    taken.push({ from, to, row });
    const byColumn = new Map(cells.map((cell) => [Math.floor(cell / rows), cell % rows]));
    const ys: number[] = [];
    let last = (cells[0] ?? 0) % rows;
    for (let column = from; column <= to; column += 1) {
      last = byColumn.get(column) ?? last;
      ys.push(yAt(column, last));
    }
    const x0 = band.x0 + from;
    const features = strokeFeatures(
      raw,
      clean,
      x0,
      ys,
      core,
      (x) => band.lift[Math.round(x - band.x0)] ?? 0,
    );
    found.push({ x0, x1: band.x0 + to + 1, ys, features, score: scoreOf(features) });
  }
  return found;
}

function inkWords(
  clean: InkMask,
  band: Band,
  core: Core,
  found: readonly Stroke[],
  options: StrikeOptions,
): InkWord[] {
  const xHeight = core.bottom - core.top;
  const columns = band.x1 - band.x0;
  const filled = new Uint8Array(columns);
  const struck = new Uint8Array(columns);
  for (let x = band.x0; x < band.x1; x += 1) {
    const shift = band.lift[x - band.x0] ?? 0;
    const crossing = found.filter((stroke) => x >= stroke.x0 && x < stroke.x1);
    if (crossing.length > 0) struck[x - band.x0] = 1;
    for (let y = core.top; y < core.bottom; y += 1) {
      if (!has(clean, x, y + shift)) continue;
      const onStroke = crossing.some(
        (stroke) => Math.abs(y + shift - (stroke.ys[x - stroke.x0] ?? 0)) <= ON_STROKE,
      );
      if (!onStroke) {
        filled[x - band.x0] = 1;
        break;
      }
    }
  }
  const gap = Math.max(3, options.wordGap * xHeight);
  const words: { x0: number; x1: number }[] = [];
  let last = -Infinity;
  for (let i = 0; i < columns; i += 1) {
    if (filled[i] !== 1) continue;
    const previous = words.at(-1);
    if (previous !== undefined && i - last <= gap) previous.x1 = band.x0 + i + 1;
    else words.push({ x0: band.x0 + i, x1: band.x0 + i + 1 });
    last = i;
  }
  const ordered = found.toSorted((a, b) => a.x0 - b.x0);
  const pieces = words.flatMap((word) => {
    const cut: { x0: number; x1: number }[] = [];
    let from = word.x0;
    for (const stroke of ordered) {
      const start = Math.max(from, stroke.x0);
      const end = Math.min(word.x1, stroke.x1);
      if (end - start < xHeight) continue;
      if (start - from >= SPLIT * xHeight) {
        cut.push({ x0: from, x1: start });
        from = start;
      }
      if (word.x1 - end >= SPLIT * xHeight) {
        cut.push({ x0: from, x1: end });
        from = end;
      }
    }
    cut.push({ x0: from, x1: word.x1 });
    return cut;
  });
  return pieces.map((word) => {
    const spans: Span[] = [];
    let start = -1;
    for (let x = word.x0; x <= word.x1; x += 1) {
      const on = x < word.x1 && struck[x - band.x0] === 1;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        spans.push([start, x]);
        start = -1;
      }
    }
    return { ...word, spans };
  });
}

function pageReference(scores: readonly number[]): number {
  if (scores.length < MIN_PAGE_STROKES) return -Infinity;
  const sorted = scores.toSorted((a, b) => b - a);
  return sorted[Math.floor(sorted.length * PAGE_QUANTILE)] ?? -Infinity;
}

interface Prepared extends StrikeCandidates {
  readonly clean: InkMask;
  readonly side: number;
}

const RULE_REACH = 2;
const RULE_PAPER = 4;
const RULE_WINDOW = 80;
const RULE_QUANTILE = 0.4;
const RULE_PAPER_QUANTILE = 0.5;
const RULE_DARKER = 1.35;

function acrossAt(points: readonly Point[], along: number, vertical: boolean): number | null {
  const key = (point: Point) => (vertical ? point.y : point.x);
  const value = (point: Point) => (vertical ? point.x : point.y);
  if (points.length < 2) return null;
  let k = 1;
  while (k < points.length - 1 && key(item(points, k)) < along) k += 1;
  const from = item(points, k - 1);
  const to = item(points, k);
  const length = key(to) - key(from);
  if (length <= 0) return value(from);
  return value(from) + ((value(to) - value(from)) * (along - key(from))) / length;
}

function eraseFaintRule(mask: InkMask, gray: GrayImage, line: RuleLine, vertical: boolean): void {
  const along = vertical ? gray.height : gray.width;
  const across = vertical ? gray.width : gray.height;
  const index = (a: number, c: number) => (vertical ? a * gray.width + c : c * gray.width + a);
  const centers = new Int32Array(along).fill(-1);
  const papers = new Float64Array(along);
  const contrasts = new Uint8Array(along);
  for (let a = 0; a < along; a += 1) {
    const guess = acrossAt(line.points, a, vertical);
    if (guess === null) continue;
    const c = Math.round(guess);
    if (c - RULE_PAPER < 0 || c + RULE_PAPER >= across) continue;
    let darkest = 255;
    for (let d = -RULE_REACH; d <= RULE_REACH; d += 1) {
      darkest = Math.min(darkest, gray.data[index(a, c + d)] ?? 255);
    }
    const paper = Math.max(
      gray.data[index(a, c - RULE_PAPER)] ?? 0,
      gray.data[index(a, c + RULE_PAPER)] ?? 0,
    );
    centers[a] = c;
    papers[a] = paper;
    contrasts[a] = Math.max(0, Math.min(255, paper - darkest));
  }
  const contrastCounts = new Int32Array(256);
  const paperCounts = new Int32Array(256);
  let counted = 0;
  const shift = (a: number, sign: number) => {
    if (a < 0 || a >= along || (centers[a] ?? -1) < 0) return;
    const contrast = contrasts[a] ?? 0;
    const paper = Math.round(papers[a] ?? 255);
    contrastCounts[contrast] = (contrastCounts[contrast] ?? 0) + sign;
    paperCounts[paper] = (paperCounts[paper] ?? 0) + sign;
    counted += sign;
  };
  const quantile = (counts: Int32Array, share: number) => {
    let value = 0;
    let seen = counts[0] ?? 0;
    while (seen < counted * share && value < 255) {
      value += 1;
      seen += counts[value] ?? 0;
    }
    return value;
  };
  for (let a = 0; a < Math.min(along, RULE_WINDOW); a += 1) shift(a, 1);
  for (let a = 0; a < along; a += 1) {
    shift(a + RULE_WINDOW, 1);
    shift(a - RULE_WINDOW - 1, -1);
    const c = centers[a] ?? -1;
    if (c < 0 || counted === 0) continue;
    const typical = quantile(contrastCounts, RULE_QUANTILE);
    const paper = quantile(paperCounts, RULE_PAPER_QUANTILE);
    for (let d = -RULE_REACH; d <= RULE_REACH; d += 1) {
      const at = index(a, c + d);
      if (mask.data[at] !== 1) continue;
      if (paper - (gray.data[at] ?? 255) < typical * RULE_DARKER) mask.data[at] = 0;
    }
  }
}

function eraseFaintRules(mask: InkMask, gray: GrayImage, ruling: Ruling): void {
  for (const line of ruling.horizontal) eraseFaintRule(mask, gray, line, false);
  for (const line of [...ruling.vertical, ruling.margins.left, ruling.margins.right]) {
    if (line !== null) eraseFaintRule(mask, gray, line, true);
  }
}

function prepare(
  image: RgbaImage,
  boxes: readonly (BBox | null)[],
  ruling: Ruling | undefined,
): Prepared {
  const gray = toWorkingGray(image, WORKING_SIDE);
  const scale = gray.scale;
  const standard = binarize(gray);
  const minContrast = Math.max(
    MIN_FAINT_CONTRAST,
    Math.min(MIN_CONTRAST, FAINT_SHARE * medianInkContrast(gray, standard)),
  );
  const raw = minContrast < MIN_CONTRAST ? binarize(gray, minContrast) : standard;
  const tan = estimateSkewTangent(raw);
  const ink = { ...raw, data: new Uint8Array(raw.data) };
  if (ruling !== undefined) {
    const working = scaleRuling(ruling, scale);
    eraseRuling(ink, gray, working);
    eraseBinding(ink, working);
    eraseFaintRules(raw, gray, working);
  }
  const clean = removeRulesAndArtifacts(ink, tan);
  const measured = boxes.map((box) => {
    if (box === null) return null;
    const x0 = Math.max(0, Math.floor(box.x * scale));
    const x1 = Math.min(raw.width, Math.ceil((box.x + box.width) * scale));
    if (x1 <= x0) return null;
    const lineBand = readBand(box);
    let band: Band;
    if (lineBand === null) {
      const rise = (x1 - x0) * tan;
      const top = Math.max(0, Math.floor(box.y * scale + Math.max(0, -rise)));
      const height = Math.max(4, Math.ceil(box.height * scale - Math.abs(rise)));
      const lift = Int32Array.from({ length: x1 - x0 }, (_, column) => Math.round(column * tan));
      band = { x0, x1, y0: top, y1: Math.min(raw.height, top + height), lift };
    } else {
      const top = Math.floor(topAt(lineBand, x0 / scale) * scale);
      const height = Math.max(4, Math.ceil(lineBand.height * scale));
      const lift = Int32Array.from(
        { length: x1 - x0 },
        (_, column) => Math.round(topAt(lineBand, (x0 + column) / scale) * scale) - top,
      );
      band = { x0, x1, y0: top, y1: top + height, lift };
    }
    const profile = rowProfile(clean, band);
    const core = coreZone(profile, band);
    if (core === null || core.bottom - core.top < 4) return null;
    return { band, profile, core };
  });
  const heights = measured.flatMap((line) =>
    line === null ? [] : [line.core.bottom - line.core.top],
  );
  const sortedHeights = heights.toSorted((a, b) => a - b);
  const pageHeight = sortedHeights[Math.floor(sortedHeights.length / 2)] ?? 0;
  const lines = measured.map((line) => {
    if (line === null) return null;
    const core =
      heights.length >= MIN_PAGE_LINES ? placeCore(line.profile, line.band, pageHeight) : line.core;
    return { band: line.band, core, found: strokes(raw, clean, line.band, core) };
  });
  return { scale, lines, clean, side: Math.max(gray.width, gray.height) };
}

export function strikeCandidates(
  image: RgbaImage,
  boxes: readonly (BBox | null)[],
  ruling?: Ruling,
): StrikeCandidates {
  const { scale, lines } = prepare(image, boxes, ruling);
  return { scale, lines };
}

export function detectStrikes(
  image: RgbaImage,
  boxes: readonly (BBox | null)[],
  options: StrikeOptions = STRIKE_OPTIONS,
  ruling?: Ruling,
): InkWord[][] {
  const { scale, lines, clean, side } = prepare(image, boxes, ruling);
  const fineness = Math.min(
    1,
    Math.max(0, (side - WORKING_MAX_SIDE) / (WORKING_SIDE - WORKING_MAX_SIDE)),
  );
  const margin = options.pageMargin + FINE_MARGIN * fineness;
  const reference = pageReference(
    lines.flatMap((line) => line?.found.map((stroke) => stroke.score) ?? []),
  );
  return lines.map((line) => {
    if (line === null) return [];
    const accepted = line.found.filter(
      (stroke) => stroke.score > options.minScore && stroke.score - reference > margin,
    );
    return inkWords(clean, line.band, line.core, accepted, options).map((word) => ({
      x0: word.x0 / scale,
      x1: word.x1 / scale,
      spans: word.spans.map(([a, b]): Span => [a / scale, b / scale]),
    }));
  });
}

const WORD = /\S+/gu;
const SKIP_INK = 1.2;
const SKIP_STRUCK_INK = 0.3;
const SKIP_WORD = 1.2;
const JOIN = 0.3;

type Step = 'pair' | 'splitInk' | 'joinedWords' | 'skipInk' | 'skipWord';

function covered(words: readonly InkWord[], from: number, to: number): number {
  let total = 0;
  for (const word of words) {
    for (const [a, b] of word.spans) total += Math.max(0, Math.min(b, to) - Math.max(a, from));
  }
  return total;
}

export function struckWordIndices(
  line: string,
  words: readonly InkWord[],
  options: StrikeOptions = STRIKE_OPTIONS,
  units: (text: string) => number = textUnits,
): number[] {
  const struckInk = words.map(
    (word) => covered([word], word.x0, word.x1) / Math.max(1e-6, word.x1 - word.x0) >= MIN_COVER,
  );
  if (!struckInk.some(Boolean)) return [];
  const texts = Array.from(line.matchAll(WORD), (match) => match[0]);
  if (texts.length === 0) return [];
  if (Math.abs(Math.log(words.length / texts.length)) > Math.log(options.wordRatio)) return [];
  const wordUnits = texts.map(units);
  const unitTotal = wordUnits.reduce((sum, value) => sum + value, 0);
  if (unitTotal === 0) return [];
  const inkTotal = words.reduce((sum, word) => sum + word.x1 - word.x0, 0);
  const scale = inkTotal / unitTotal;
  const space = units(' ');
  const m = words.length;
  const n = texts.length;
  const span = (from: number, to: number) => (words[to - 1]?.x1 ?? 0) - (words[from]?.x0 ?? 0);
  const fit = (ink: number, expected: number) =>
    Math.abs(Math.log(Math.max(1, ink) / Math.max(1e-6, expected * scale)));
  const cost = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  const steps = Array.from({ length: m + 1 }, () =>
    Array.from<Step | undefined>({ length: n + 1 }),
  );
  const relax = (i: number, j: number, value: number, step: Step) => {
    const row = cost[i];
    if (row === undefined || j > n || value >= (row[j] ?? Infinity)) return;
    row[j] = value;
    const stepRow = steps[i];
    if (stepRow !== undefined) stepRow[j] = step;
  };
  relax(0, 0, 0, 'pair');
  for (let i = 0; i <= m; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      const here = cost[i]?.[j] ?? Infinity;
      if (!Number.isFinite(here)) continue;
      const first = wordUnits[j] ?? 0;
      if (i < m && j < n) relax(i + 1, j + 1, here + fit(span(i, i + 1), first), 'pair');
      if (i + 1 < m && j < n)
        relax(i + 2, j + 1, here + JOIN + fit(span(i, i + 2), first), 'splitInk');
      if (i < m && j + 1 < n) {
        const both = first + space + (wordUnits[j + 1] ?? 0);
        relax(i + 1, j + 2, here + JOIN + fit(span(i, i + 1), both), 'joinedWords');
      }
      if (i < m) relax(i + 1, j, here + (struckInk[i] ? SKIP_STRUCK_INK : SKIP_INK), 'skipInk');
      if (j < n) relax(i, j + 1, here + SKIP_WORD, 'skipWord');
    }
  }
  const struck: number[] = [];
  const check = (index: number, from: number, to: number) => {
    if (to > from && covered(words, from, to) / (to - from) >= options.share) struck.push(index);
  };
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const step = steps[i]?.[j];
    if (step === 'pair') {
      check(j - 1, words[i - 1]?.x0 ?? 0, words[i - 1]?.x1 ?? 0);
      i -= 1;
      j -= 1;
    } else if (step === 'splitInk') {
      check(j - 1, words[i - 2]?.x0 ?? 0, words[i - 1]?.x1 ?? 0);
      i -= 2;
      j -= 1;
    } else if (step === 'joinedWords') {
      const word = words[i - 1];
      const before = wordUnits[j - 2] ?? 0;
      const after = wordUnits[j - 1] ?? 0;
      const x0 = word?.x0 ?? 0;
      const x1 = word?.x1 ?? 0;
      const cut = x0 + ((x1 - x0) * (before + space / 2)) / (before + space + after);
      check(j - 2, x0, cut);
      check(j - 1, cut, x1);
      i -= 1;
      j -= 2;
    } else if (step === 'skipInk') {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return struck.toSorted((a, b) => a - b);
}

export function findStruckWords(
  image: RgbaImage,
  lines: readonly string[],
  options: StrikeOptions = STRIKE_OPTIONS,
): number[][] {
  const plain = lines.map((line) => line.replaceAll('~~', ''));
  const layout = locateLines(image, plain);
  const parts = layout.lines.map((line): BBox[] => {
    if (line === null || line.rough === true) return [];
    return line.bbox.rows === undefined ? [line.bbox] : [...line.bbox.rows];
  });
  const words = detectStrikes(image, parts.flat(), options, layout.ruling);
  let next = 0;
  return plain.map((line, index) => {
    const found = (parts[index] ?? []).flatMap(() => {
      next += 1;
      return words[next - 1] ?? [];
    });
    return struckWordIndices(line, found, options);
  });
}
