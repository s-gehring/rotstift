import { iou } from './synthetic.ts';
import type { BBox, LineLocation } from './types.ts';

export interface TruthLine {
  readonly text: string;
  readonly bbox: BBox | null;
}

export interface Variant {
  readonly name: string;
  readonly transcript: readonly string[];
  readonly expected: readonly (BBox | null)[];
  readonly erased: BBox | null;
}

export interface VariantScore {
  readonly name: string;
  readonly expected: number;
  readonly correct: number;
  readonly missing: number;
  readonly wrong: number;
  readonly spurious: number;
}

const EXTRA_LINES = [
  'Name: Max Mustermann',
  'Dies ist eine zusätzliche Zeile die es auf der Seite gar nicht gibt',
];

function union(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function build(
  name: string,
  parts: readonly { text: string; bbox: BBox | null }[],
  erased: BBox | null = null,
): Variant {
  return {
    name,
    transcript: parts.map((part) => part.text),
    expected: parts.map((part) => part.bbox),
    erased,
  };
}

type Part = { text: string; bbox: BBox | null };

export function variantsOf(lines: readonly TruthLine[]): Variant[] {
  const all: Part[] = lines.map((line) => ({ text: line.text, bbox: line.bbox }));
  const realIndexes = all.flatMap((line, k) => (line.bbox === null ? [] : [k]));
  const at = (n: number) => realIndexes[Math.min(Math.max(n, 0), realIndexes.length - 1)] ?? 0;
  const first = at(0);
  const middle = at(Math.floor(realIndexes.length / 2));
  const last = at(realIndexes.length - 1);
  const without = (index: number) => all.filter((_, k) => k !== index);

  const target = all[middle];
  const nextIndex = realIndexes.find((k) => k > middle);
  const next = nextIndex === undefined ? undefined : all[nextIndex];
  const split = (): Part[] => {
    if (target?.bbox == null) return all;
    const words = target.text.split(' ');
    const cut = Math.max(1, Math.floor(words.length / 2));
    const left = words.slice(0, cut).join(' ');
    const right = words.slice(cut).join(' ');
    const share = left.length / (left.length + right.length + 1);
    const { x, y, width, height } = target.bbox;
    return all.flatMap((line, k) =>
      k === middle
        ? [
            { text: left, bbox: { x, y, width: width * share, height } },
            { text: right, bbox: { x: x + width * share, y, width: width * (1 - share), height } },
          ]
        : [line],
    );
  };
  const merged = (): Part[] =>
    all.flatMap((line, k) => {
      if (k === middle && next?.bbox != null && line.bbox !== null) {
        return [{ text: `${line.text} ${next.text}`, bbox: union(line.bbox, next.bbox) }];
      }
      return k === nextIndex ? [] : [line];
    });
  const inserted = (index: number, text: string): Part[] => [
    ...all.slice(0, index),
    { text, bbox: null },
    ...all.slice(index),
  ];

  return [
    build('unverändert', all),
    build('erste Zeile fehlt im Transkript', without(first)),
    build('mittlere Zeile fehlt im Transkript', without(middle)),
    build('letzte Zeile fehlt im Transkript', without(last)),
    build('Zeile geteilt', split()),
    build('zwei Zeilen verschmolzen', merged()),
    build('Überschrift eingefügt', inserted(0, EXTRA_LINES[0] ?? '')),
    build('Zeile in der Mitte eingefügt', inserted(middle, EXTRA_LINES[1] ?? '')),
    build(
      'Zeile im Bild gelöscht',
      all.map((line, k) => (k === middle ? { text: line.text, bbox: null } : line)),
      target?.bbox ?? null,
    ),
  ];
}

export function scoreVariant(
  variant: Variant,
  found: readonly (LineLocation | null)[],
): VariantScore {
  let expected = 0;
  let correct = 0;
  let missing = 0;
  let wrong = 0;
  let spurious = 0;
  variant.expected.forEach((box, index) => {
    const line = found[index] ?? null;
    if (box === null) {
      if (line !== null) spurious += 1;
      return;
    }
    expected += 1;
    if (line === null) missing += 1;
    else if (iou(box, line.bbox) >= 0.5) correct += 1;
    else wrong += 1;
  });
  return { name: variant.name, expected, correct, missing, wrong, spurious };
}

export function sumScores(scores: readonly VariantScore[]): VariantScore {
  const total = {
    name: scores[0]?.name ?? '',
    expected: 0,
    correct: 0,
    missing: 0,
    wrong: 0,
    spurious: 0,
  };
  for (const score of scores) {
    total.expected += score.expected;
    total.correct += score.correct;
    total.missing += score.missing;
    total.wrong += score.wrong;
    total.spurious += score.spurious;
  }
  return total;
}

export function paintOver(
  image: { width: number; data: Uint8ClampedArray | Uint8Array },
  box: BBox,
  value: number,
): void {
  const margin = 4;
  const x0 = Math.max(0, Math.floor(box.x - margin));
  const x1 = Math.floor(box.x + box.width + margin);
  const y0 = Math.max(0, Math.floor(box.y - margin));
  const y1 = Math.floor(box.y + box.height + margin);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * image.width + x) * 4;
      image.data[at] = value;
      image.data[at + 1] = value;
      image.data[at + 2] = value;
    }
  }
}
