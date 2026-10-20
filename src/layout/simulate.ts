import type { Candidate } from './assign.ts';

export interface SimulationVariant {
  readonly name: string;
  readonly transcript: readonly string[];
  readonly expected: readonly (number | null)[];
}

export interface SimulationPage {
  readonly candidates: Candidate[];
  readonly variants: SimulationVariant[];
}

export interface SimulationTotals {
  readonly lines: number;
  readonly correct: number;
  readonly wrong: number;
  readonly wrongConfident: number;
  readonly missing: number;
}

const text = (length: number) => 'x'.repeat(length);

const PITCH = 60;
const CHAR_WIDTH = 20;

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulatePage(seed: number, lineCount: number, widthSpread: number): SimulationPage {
  const next = mulberry(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const lengths = Array.from({ length: lineCount }, () => 25 + Math.floor(next() * 31));
  const candidates = lengths.map((length, k): Candidate => {
    const width = Math.max(10, length * CHAR_WIDTH * Math.exp(widthSpread * gauss()));
    const top = 100 + k * PITCH + (next() - 0.5) * 6;
    return { x: 100, y: top, width, height: 40, inkCount: Math.round(width * 3), row: top + 20 };
  });
  const all = lengths.map((_, k): number | null => k);
  const dropAt = Math.floor(next() * lineCount);
  const insertAt = Math.floor(next() * (lineCount + 1));
  const insertedLength = 25 + Math.floor(next() * 31);
  const variants: SimulationVariant[] = [
    { name: 'sauber', transcript: lengths.map(text), expected: all },
    {
      name: 'eine Zeile fehlt',
      transcript: lengths.filter((_, k) => k !== dropAt).map(text),
      expected: all.filter((_, k) => k !== dropAt),
    },
    {
      name: 'erste Zeile fehlt',
      transcript: lengths.slice(1).map(text),
      expected: all.slice(1),
    },
    {
      name: 'letzte Zeile fehlt',
      transcript: lengths.slice(0, -1).map(text),
      expected: all.slice(0, -1),
    },
    {
      name: 'eine Zeile zu viel',
      transcript: [...lengths.slice(0, insertAt), insertedLength, ...lengths.slice(insertAt)].map(
        text,
      ),
      expected: [...all.slice(0, insertAt), null, ...all.slice(insertAt)],
    },
  ];
  return { candidates, variants };
}

export function tally(
  expected: readonly (number | null)[],
  found: readonly ({ bbox: { y: number }; confidence: number } | null)[],
  candidates: readonly Candidate[],
): SimulationTotals {
  let correct = 0;
  let wrong = 0;
  let wrongConfident = 0;
  let missing = 0;
  let lines = 0;
  expected.forEach((index, k) => {
    const line = found[k] ?? null;
    const truth = index === null ? undefined : candidates[index];
    if (truth !== undefined) lines += 1;
    if (line === null) {
      if (truth !== undefined) missing += 1;
      return;
    }
    if (truth !== undefined && Math.abs(line.bbox.y - truth.y) < 1) {
      correct += 1;
      return;
    }
    wrong += 1;
    if (line.confidence >= 0.5) wrongConfident += 1;
  });
  return { lines, correct, wrong, wrongConfident, missing };
}
