import { textUnits } from '../overlay/char-width.ts';
import { toWorkingGray } from './gray.ts';
import { binarize, estimateSkewTangent, removeRulesAndArtifacts, type InkMask } from './ink.ts';
import { locateLines } from './locate-lines.ts';
import type { BBox, RgbaImage } from './types.ts';

export interface StrikeOptions {
  readonly minLength: number;
  readonly maxLength: number;
  readonly crossing: number;
  readonly exact: number;
  readonly coverage: number;
  readonly gap: number;
  readonly wordGap: number;
}

export const STRIKE_OPTIONS: StrikeOptions = {
  minLength: 3,
  maxLength: 0.45,
  crossing: 0.3,
  exact: 0.8,
  coverage: 0.5,
  gap: 1,
  wordGap: 0.5,
};

export interface InkWord {
  readonly x0: number;
  readonly x1: number;
  readonly struck: boolean;
}

interface Band {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

interface Core {
  readonly top: number;
  readonly bottom: number;
}

interface Stroke {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly slope: number;
}

const MAX_TILT = 0.08;
const TILT_STEPS = 8;
const CORE_SHARE = 0.45;

function has(mask: InkMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.data[y * mask.width + x] === 1;
}

function thick(mask: InkMask, x: number, y: number): boolean {
  return has(mask, x, y) || has(mask, x, y - 1) || has(mask, x, y + 1);
}

function inkBetween(mask: InkMask, x: number, from: number, to: number): boolean {
  for (let y = Math.min(from, to); y <= Math.max(from, to); y += 1) {
    if (has(mask, x, y)) return true;
  }
  return false;
}

function coreZone(clean: InkMask, band: Band, tan: number): Core | null {
  const height = band.y1 - band.y0;
  const profile = new Float64Array(height);
  for (let x = band.x0; x < band.x1; x += 1) {
    const shift = Math.round((x - band.x0) * tan);
    for (let row = 0; row < height; row += 1) {
      if (has(clean, x, band.y0 + row + shift)) profile[row] = (profile[row] ?? 0) + 1;
    }
  }
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

function isStrike(
  raw: InkMask,
  clean: InkMask,
  stroke: Stroke,
  band: Band,
  xHeight: number,
  options: StrikeOptions,
): boolean {
  const length = stroke.x1 - stroke.x0;
  const near = Math.ceil(0.25 * xHeight);
  const far = Math.ceil(0.6 * xHeight);
  let above = 0;
  let below = 0;
  let exact = 0;
  for (let x = stroke.x0; x < stroke.x1; x += 1) {
    const y = stroke.y0 + Math.round((x - band.x0) * stroke.slope);
    if (inkBetween(clean, x, y - near, y - far)) above += 1;
    if (inkBetween(clean, x, y + near, y + far)) below += 1;
    if (has(raw, x, y)) exact += 1;
  }
  return Math.min(above, below) / length >= options.crossing && exact / length >= options.exact;
}

function strokes(
  raw: InkMask,
  clean: InkMask,
  band: Band,
  core: Core,
  tan: number,
  options: StrikeOptions,
): Stroke[] {
  const xHeight = core.bottom - core.top;
  const minLength = Math.max(12, options.minLength * xHeight);
  const maxLength = options.maxLength * raw.width;
  const lowest = Math.round(core.top + 0.15 * xHeight);
  const highest = Math.round(core.bottom - 0.3 * xHeight);
  const found: Stroke[] = [];
  for (let step = -TILT_STEPS; step <= TILT_STEPS; step += 1) {
    const slope = tan + (MAX_TILT * step) / TILT_STEPS;
    for (let y0 = lowest; y0 <= highest; y0 += 1) {
      let start = -1;
      let last = -1;
      for (let x = band.x0; x <= band.x1; x += 1) {
        const inside = x < band.x1;
        if (inside && thick(raw, x, y0 + Math.round((x - band.x0) * slope))) {
          if (start < 0) start = x;
          last = x;
          continue;
        }
        if (start < 0 || (inside && x - last <= options.gap)) continue;
        const length = last - start + 1;
        const endY = y0 + Math.round((last - band.x0) * slope);
        const central = endY >= lowest - 0.1 * xHeight && endY <= highest + 0.1 * xHeight;
        const stroke = { x0: start, x1: last + 1, y0, slope };
        if (
          length >= minLength &&
          length <= maxLength &&
          central &&
          isStrike(raw, clean, stroke, band, xHeight, options)
        ) {
          found.push(stroke);
        }
        start = -1;
      }
    }
  }
  return found;
}

function inkWords(
  clean: InkMask,
  band: Band,
  core: Core,
  tan: number,
  found: readonly Stroke[],
  options: StrikeOptions,
): InkWord[] {
  const xHeight = core.bottom - core.top;
  const columns = band.x1 - band.x0;
  const filled = new Uint8Array(columns);
  const struck = new Uint8Array(columns);
  for (let x = band.x0; x < band.x1; x += 1) {
    const shift = Math.round((x - band.x0) * tan);
    const crossing = found.filter((stroke) => x >= stroke.x0 && x < stroke.x1);
    if (crossing.length > 0) struck[x - band.x0] = 1;
    for (let y = core.top; y < core.bottom; y += 1) {
      if (!has(clean, x, y + shift)) continue;
      const onStroke = crossing.some(
        (stroke) =>
          Math.abs(y + shift - (stroke.y0 + Math.round((x - band.x0) * stroke.slope))) <= 2,
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
  return words.map((word) => {
    let covered = 0;
    for (let x = word.x0; x < word.x1; x += 1) covered += struck[x - band.x0] ?? 0;
    return { ...word, struck: covered / (word.x1 - word.x0) >= options.coverage };
  });
}

export function detectStrikes(
  image: RgbaImage,
  boxes: readonly (BBox | null)[],
  options: StrikeOptions = STRIKE_OPTIONS,
): InkWord[][] {
  const gray = toWorkingGray(image);
  const raw = binarize(gray);
  const tan = estimateSkewTangent(raw);
  const clean = removeRulesAndArtifacts({ ...raw, data: new Uint8Array(raw.data) }, tan);
  const scale = gray.scale;
  return boxes.map((box) => {
    if (box === null) return [];
    const x0 = Math.max(0, Math.floor(box.x * scale));
    const x1 = Math.min(raw.width, Math.ceil((box.x + box.width) * scale));
    const rise = (x1 - x0) * tan;
    const top = Math.max(0, Math.floor(box.y * scale + Math.max(0, -rise)));
    const height = Math.max(4, Math.ceil(box.height * scale - Math.abs(rise)));
    const band = { x0, x1, y0: top, y1: Math.min(raw.height, top + height) };
    const core = coreZone(clean, band, tan);
    if (core === null || core.bottom - core.top < 4) return [];
    const found = strokes(raw, clean, band, core, tan, options);
    return inkWords(clean, band, core, tan, found, options).map((word) => ({
      ...word,
      x0: word.x0 / scale,
      x1: word.x1 / scale,
    }));
  });
}

const WORD = /\S+/gu;
const SKIP_INK = 1.2;
const SKIP_STRUCK_INK = 0.5;
const SKIP_WORD = 1.2;
const JOIN = 0.3;

type Step = 'pair' | 'splitInk' | 'joinedWords' | 'skipInk' | 'skipWord';

export function struckWordIndices(
  line: string,
  words: readonly InkWord[],
  units: (text: string) => number = textUnits,
): number[] {
  if (!words.some((word) => word.struck)) return [];
  const texts = Array.from(line.matchAll(WORD), (match) => match[0]);
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
      if (i < m) relax(i + 1, j, here + (words[i]?.struck ? SKIP_STRUCK_INK : SKIP_INK), 'skipInk');
      if (j < n) relax(i, j + 1, here + SKIP_WORD, 'skipWord');
    }
  }
  const struck: number[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const step = steps[i]?.[j];
    if (step === 'pair') {
      if (words[i - 1]?.struck) struck.push(j - 1);
      i -= 1;
      j -= 1;
    } else if (step === 'splitInk') {
      if (words[i - 1]?.struck && words[i - 2]?.struck) struck.push(j - 1);
      i -= 2;
      j -= 1;
    } else if (step === 'joinedWords') {
      if (words[i - 1]?.struck) struck.push(j - 2, j - 1);
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
  const parts = locateLines(image, plain).lines.map((line): BBox[] => {
    if (line === null || line.rough === true) return [];
    return line.bbox.rows === undefined ? [line.bbox] : [...line.bbox.rows];
  });
  const words = detectStrikes(image, parts.flat(), options);
  let next = 0;
  return plain.map((line, index) => {
    const found = (parts[index] ?? []).flatMap(() => {
      next += 1;
      return words[next - 1] ?? [];
    });
    return struckWordIndices(line, found);
  });
}
