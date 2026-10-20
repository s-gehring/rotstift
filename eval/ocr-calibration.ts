import process from 'node:process';
import { parseArgs } from 'node:util';
import { wilson } from './correct-report.ts';

export interface ScoredWord {
  confidence: number;
  wrong: boolean;
}

export interface CalibrationBin {
  from: number;
  to: number;
  words: number;
  wrong: number;
  meanConfidence: number;
}

export const CALIBRATION_EDGES = [0, 0.5, 0.7, 0.9, 0.95, 0.98, 0.99, 1];

export function auc(positive: readonly number[], negative: readonly number[]): number {
  let sum = 0;
  for (const low of positive) {
    for (const high of negative) sum += low < high ? 1 : low === high ? 0.5 : 0;
  }
  return sum / positive.length / negative.length;
}

export function calibrationBins(
  words: readonly ScoredWord[],
  edges: readonly number[] = CALIBRATION_EDGES,
): CalibrationBin[] {
  return edges.slice(0, -1).map((from, index) => {
    const to = edges[index + 1] ?? 1;
    const last = index === edges.length - 2;
    const inside = words.filter(
      (word) => word.confidence >= from && (last ? word.confidence <= to : word.confidence < to),
    );
    return {
      from,
      to,
      words: inside.length,
      wrong: inside.filter((word) => word.wrong).length,
      meanConfidence:
        inside.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, inside.length),
    };
  });
}

export function calibrationError(bins: readonly CalibrationBin[]): number {
  const total = bins.reduce((sum, bin) => sum + bin.words, 0);
  return bins.reduce(
    (sum, bin) =>
      sum +
      (bin.words / total) * Math.abs(1 - bin.wrong / Math.max(1, bin.words) - bin.meanConfidence),
    0,
  );
}

export function separation(words: readonly ScoredWord[]): number {
  return auc(
    words.filter((word) => word.wrong).map((word) => word.confidence),
    words.filter((word) => !word.wrong).map((word) => word.confidence),
  );
}

const share = (count: number, total: number) =>
  total === 0 ? '–' : `${((100 * count) / total).toFixed(0)} %`;

export function calibrationTable(label: string, words: readonly ScoredWord[]): string {
  const bins = calibrationBins(words);
  const wrong = words.filter((word) => word.wrong).length;
  const separated = wrong > 0 && wrong < words.length ? separation(words).toFixed(3) : 'n. v.';
  const rows = bins.map((bin) => {
    const [low, high] = wilson(bin.wrong, bin.words);
    const interval =
      bin.words === 0 ? '' : ` (${Math.max(0, 100 * low).toFixed(0)}–${(100 * high).toFixed(0)})`;
    return `| ${bin.from}–${bin.to} | ${bin.words} (${share(bin.words, words.length)}) | ${bin.meanConfidence.toFixed(3)} | ${share(bin.wrong, bin.words)}${interval} | ${share(bin.wrong, wrong)} |`;
  });
  return [
    `${label}: ${words.length} Wörter, ${wrong} falsch, AUC ${separated}, Kalibrierungsfehler ${calibrationError(bins).toFixed(3)}`,
    '',
    '| Lesesicherheit | Wörter | mittlere Sicherheit | davon falsch | Anteil aller Fehler |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      ocr: { type: 'string', multiple: true, default: [] },
      dataset: { type: 'string' },
    },
  });
  if (values.ocr.length === 0 || !values.dataset) throw new Error('--ocr und --dataset angeben');
  const { scadsWords } = await import('./ocr-word-measures.ts');
  const out = values.ocr.map((file) =>
    calibrationTable(
      file.split('/').at(-1) ?? file,
      scadsWords(file, values.dataset ?? '').map((entry) => ({
        confidence: entry.word.scores.min,
        wrong: entry.misread,
      })),
    ),
  );
  process.stdout.write(`${out.join('\n')}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
