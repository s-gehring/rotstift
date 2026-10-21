import { item } from './signal.ts';
import type { BBox, RgbaImage } from './types.ts';

export interface PageSpec {
  readonly width: number;
  readonly height: number;
  readonly pitch: number;
  readonly lines: readonly string[];
  readonly seed?: number;
  readonly ruled?: boolean;
  readonly margin?: boolean;
  readonly skewDegrees?: number;
  readonly wobble?: number;
  readonly drift?: number;
  readonly longStrokes?: boolean;
  readonly headings?: readonly number[];
  readonly strays?: number;
  readonly noise?: number;
  readonly indent?: readonly number[];
  readonly struck?: readonly (readonly number[])[];
}

export interface SyntheticPage {
  readonly image: RgbaImage;
  readonly truth: readonly (BBox | null)[];
}

const WORDS = [
  'der',
  'Hund',
  'läuft',
  'schnell',
  'durch',
  'den',
  'großen',
  'Garten',
  'und',
  'spielt',
  'mit',
  'dem',
  'Ball',
  'weil',
  'die',
  'Sonne',
  'scheint',
  'am',
  'Morgen',
  'gehen',
  'wir',
  'zur',
  'Schule',
  'mein',
  'Bruder',
  'hat',
  'gestern',
  'ein',
  'Buch',
  'gelesen',
  'jeden',
  'Tag',
  'Freunde',
  'besuchen',
  'oft',
  'Oma',
  'backt',
  'Kuchen',
  'Winter',
  'Schnee',
];

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleLines(seed: number, count: number, minChars = 26, maxChars = 40): string[] {
  const next = random(seed);
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const target = minChars + Math.floor(next() * (maxChars - minChars + 1));
    let line = '';
    while (line.length < target) {
      const word = WORDS[Math.floor(next() * WORDS.length)] ?? 'der';
      if (line.length + word.length + 1 > maxChars) break;
      line = line === '' ? word : `${line} ${word}`;
    }
    lines.push(line);
  }
  return lines;
}

const ASCENDERS = new Set('bdfhklt'.split('').concat('ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'.split('')));
const DESCENDERS = new Set('gjpqyz'.split(''));

export function renderPage(spec: PageSpec): SyntheticPage {
  const { width, height, pitch } = spec;
  const next = random(spec.seed ?? 1);
  const theta = ((spec.skewDegrees ?? 0) * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const centerX = width / 2;
  const centerY = height / 2;
  const rotate = (x: number, y: number): [number, number] => [
    centerX + (x - centerX) * cosT - (y - centerY) * sinT,
    centerY + (x - centerX) * sinT + (y - centerY) * cosT,
  ];

  const paper = new Float32Array(width * height).fill(236);
  const ink = new Float32Array(width * height);
  const noise = spec.noise ?? 4;
  for (let i = 0; i < paper.length; i += 1) paper[i] = (paper[i] ?? 0) + (next() - 0.5) * noise * 2;

  const stamp = (
    layer: Float32Array,
    x: number,
    y: number,
    radius: number,
    box: { x0: number; y0: number; x1: number; y1: number } | null,
  ) => {
    const x0 = Math.max(0, Math.floor(x - radius - 1));
    const x1 = Math.min(width - 1, Math.ceil(x + radius + 1));
    const y0 = Math.max(0, Math.floor(y - radius - 1));
    const y1 = Math.min(height - 1, Math.ceil(y + radius + 1));
    for (let py = y0; py <= y1; py += 1) {
      for (let px = x0; px <= x1; px += 1) {
        const distance = Math.hypot(px + 0.5 - x, py + 0.5 - y);
        const coverage = Math.min(1, Math.max(0, radius + 0.5 - distance));
        if (coverage <= 0) continue;
        const at = py * width + px;
        layer[at] = Math.max(layer[at] ?? 0, coverage);
        if (box !== null && coverage >= 0.5) {
          box.x0 = Math.min(box.x0, px);
          box.y0 = Math.min(box.y0, py);
          box.x1 = Math.max(box.x1, px);
          box.y1 = Math.max(box.y1, py);
        }
      }
    }
  };

  const stroke = (
    layer: Float32Array,
    points: readonly [number, number][],
    radius: number,
    box: { x0: number; y0: number; x1: number; y1: number } | null,
  ) => {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const from = item(points, i);
      const to = item(points, i + 1);
      const [ax, ay] = rotate(from[0], from[1]);
      const [bx, by] = rotate(to[0], to[1]);
      const steps = Math.max(
        1,
        Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(0.5, radius * 0.5)),
      );
      for (let s = 0; s <= steps; s += 1) {
        stamp(layer, ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, radius, box);
      }
    }
  };

  const spacing = pitch;
  const top = spacing * 1.6;
  const ruleLayer = new Float32Array(width * height);
  if (spec.ruled === true) {
    for (let k = -2; top + k * spacing < height + spacing; k += 1) {
      const y = top + k * spacing + spacing * 0.1;
      stroke(
        ruleLayer,
        [
          [-width, y],
          [width * 2, y],
        ],
        1,
        null,
      );
    }
  }
  if (spec.margin === true) {
    const x = width * 0.13;
    for (const dx of [0, 5]) {
      stroke(
        ruleLayer,
        [
          [x + dx, -height],
          [x + dx, height * 2],
        ],
        1,
        null,
      );
    }
  }

  const penRadius = Math.max(1, pitch * 0.035);
  const truth: (BBox | null)[] = [];
  const left = width * (spec.margin === true ? 0.17 : 0.08);
  const advance = pitch * 0.4;
  const headings = new Set(spec.headings ?? []);

  spec.lines.forEach((text, index) => {
    if (text.trim() === '') {
      truth.push(null);
      return;
    }
    const heading = headings.has(index);
    const scale = heading ? 1.5 : 1;
    const box = { x0: width, y0: height, x1: -1, y1: -1 };
    const baseline = top + index * spacing;
    const phase = next() * Math.PI * 2;
    const wobbleAt = (x: number) =>
      (spec.wobble ?? 0) * Math.sin(x / (width * 0.2) + phase) + (spec.drift ?? 0) * (x - left);
    let x = left + (spec.indent?.[index] ?? 0) * pitch;
    const xHeight = pitch * 0.34 * scale;
    const struck = new Set(spec.struck?.[index] ?? []);
    let word = 0;
    let wordStart = x;
    const strikeWord = () => {
      if (!struck.has(word)) return;
      const middle = baseline - xHeight * 0.45;
      stroke(
        ink,
        [
          [wordStart - advance * 0.3, middle + wobbleAt(wordStart)],
          [x + advance * 0.3, middle + wobbleAt(x) - pitch * 0.03],
        ],
        penRadius * scale,
        box,
      );
    };
    for (const [at, character] of Array.from(text).entries()) {
      if (character === ' ') {
        if (text[at - 1] !== ' ') {
          strikeWord();
          word += 1;
        }
        x += advance * 0.7 * scale;
        wordStart = x;
        continue;
      }
      const base = baseline + wobbleAt(x);
      const points: [number, number][] = [];
      const jitter = () => (next() - 0.5) * pitch * 0.04;
      for (let step = 0; step <= 10; step += 1) {
        const angle = (step / 10) * Math.PI * 2;
        points.push([
          x + advance * scale * 0.3 * (1 + Math.cos(angle)) + jitter(),
          base - xHeight * 0.5 * (1 + Math.sin(angle * 1.5)) + jitter(),
        ]);
      }
      stroke(ink, points, penRadius * scale, box);
      const stemX = x + advance * scale * 0.55;
      if (ASCENDERS.has(character)) {
        const reach =
          pitch * (spec.longStrokes === true ? 0.8 : 0.65) * scale * (0.85 + next() * 0.15);
        stroke(
          ink,
          [
            [stemX, base],
            [stemX + jitter(), base - reach],
          ],
          penRadius * scale,
          box,
        );
      }
      if (DESCENDERS.has(character)) {
        const reach =
          pitch * (spec.longStrokes === true ? 0.55 : 0.4) * scale * (0.85 + next() * 0.15);
        stroke(
          ink,
          [
            [stemX, base - xHeight * 0.5],
            [stemX + jitter(), base + reach],
          ],
          penRadius * scale,
          box,
        );
      }
      x += advance * scale * (0.85 + next() * 0.3);
    }
    if (!text.endsWith(' ')) strikeWord();
    truth.push(
      box.x1 < 0
        ? null
        : { x: box.x0, y: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 },
    );
  });

  for (let i = 0; i < (spec.strays ?? 0); i += 1) {
    const x = width * (0.1 + next() * 0.8);
    const y = next() < 0.5 ? spacing * 0.2 : height - spacing * 0.3;
    stroke(
      ink,
      [
        [x, y],
        [x + pitch * 0.5, y + pitch * 0.2],
        [x + pitch * 0.2, y - pitch * 0.2],
      ],
      penRadius,
      null,
    );
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    let value = paper[i] ?? 236;
    value -= (ruleLayer[i] ?? 0) * 62;
    value = value * (1 - (ink[i] ?? 0)) + 45 * (ink[i] ?? 0);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { image: { width, height, data }, truth };
}

export function iou(a: BBox, b: BBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.width * a.height + b.width * b.height - overlap;
  return union <= 0 ? 0 : overlap / union;
}
