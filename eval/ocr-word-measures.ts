import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import type { Mark } from '../src/annotations/transcript.ts';
import { charProbabilities, lineProbabilities } from '../src/correction/reading-confidence.ts';
import { splitTranscript } from '../src/pipeline/transcript-lines.ts';
import { goldFromMarkup } from './gold.ts';
import { auc } from './ocr-calibration.ts';
import { remapGold } from './mark-metrics.ts';
import { attributeMarks } from './ocr-attribution.ts';
import { truthLines } from './ocr-correct.ts';
import type { OcrRun } from './ocr-run.ts';
import { normalizeLine } from './ocr-score.ts';
import { samplesDir } from './paths.ts';

type Page = OcrRun['pages'][number];

const MEASURES = ['min', 'product', 'perToken', 'perChar', 'minLong'] as const;
type Measure = (typeof MEASURES)[number];

export interface WordScore {
  line: number;
  offset: number;
  text: string;
  length: number;
  scores: Record<Measure, number>;
}

function tokenOwners(page: Page): number[] {
  const owners: number[] = [];
  page.tokens.forEach((token, index) => {
    for (let byte = 0; byte < token.bytes.length; byte += 1) owners.push(index);
  });
  const result: number[] = [];
  let offset = 0;
  for (const char of page.content) {
    const owner = (owners[offset] ?? -2) + 2;
    for (let unit = 0; unit < char.length; unit += 1) result.push(owner);
    offset += new TextEncoder().encode(char).length;
  }
  return result;
}

export function wordScores(page: Page, lines: readonly string[]): WordScore[] {
  const chars = charProbabilities(page.content, page.tokens);
  if (!chars) return [];
  const probabilities = lineProbabilities(page.content, chars, lines);
  const owners = lineProbabilities(page.content, tokenOwners(page), lines);
  return lines.flatMap((line, lineIndex) =>
    Array.from(line.matchAll(/\p{L}+(?:-\p{L}+)*/gu), (match) => {
      const tokens = new Set<number>();
      let min = 1;
      for (let index = match.index; index < match.index + match[0].length; index += 1) {
        min = Math.min(min, probabilities[lineIndex]?.[index] ?? 1);
        const owner = owners[lineIndex]?.[index] ?? 1;
        if (owner > 1) tokens.add(owner - 2);
      }
      const logprob = Array.from(tokens).reduce(
        (sum, token) => sum + (page.tokens[token]?.logprob ?? 0),
        0,
      );
      const length = Array.from(match[0]).length;
      return {
        line: lineIndex,
        offset: match.index,
        text: match[0],
        length,
        scores: {
          min,
          product: Math.exp(logprob),
          perToken: Math.exp(logprob / Math.max(1, tokens.size)),
          perChar: Math.exp(logprob / length),
          minLong: length > 6 ? min ** (6 / length) : min,
        },
      };
    }),
  );
}

function asMark(word: WordScore): Mark {
  return { kind: 'error', type: 'R', original: word.text, correction: '', offset: word.offset };
}

export function pageWords(page: Page, truth: readonly string[]) {
  const lines = splitTranscript(page.content).map(normalizeLine);
  const attribution = attributeMarks(truth, lines);
  return wordScores(page, lines).map((word) => ({
    word,
    misread: attribution.cause(word.line, asMark(word)) === 'reading',
  }));
}

export function scadsWords(ocrFile: string, dataset: string) {
  const run: OcrRun = JSON.parse(readFileSync(ocrFile, 'utf8'));
  return run.pages
    .filter((page) => page.finishReason === 'stop')
    .flatMap((page) => pageWords(page, truthLines(dataset, page.name)));
}

function renderedWords(ocrFile: string) {
  const run: OcrRun = JSON.parse(readFileSync(ocrFile, 'utf8'));
  return run.pages.flatMap((page) => {
    const lines = splitTranscript(page.content).map(normalizeLine);
    const text = page.name.split('--')[0] ?? page.name;
    const markup = readFileSync(join(samplesDir, 'texts', `${text}.txt`), 'utf8').trim();
    const input = {
      lines: lines.map((line, index) => ({ number: index + 1, text: line, marks: [] })),
    };
    const gold = remapGold(goldFromMarkup(markup).gold, input).gold;
    const errors = new Set<string>();
    gold.lines.forEach((line, index) => {
      for (const mark of line.marks) {
        if (mark.kind !== 'error') continue;
        const end = mark.offset + Math.max(1, mark.original.length);
        for (let position = mark.offset; position < end; position += 1) {
          errors.add(`${index}:${position}`);
        }
      }
    });
    return wordScores(page, lines).map((word) => ({
      word,
      error: Array.from(word.text, (_, index) => `${word.line}:${word.offset + index}`).some(
        (key) => errors.has(key),
      ),
    }));
  });
}

function share(values: readonly number[], threshold: number): string {
  return `${Math.round((100 * values.filter((value) => value < threshold).length) / values.length)} %`;
}

function main() {
  const { values } = parseArgs({
    options: {
      ocr: { type: 'string' },
      dataset: { type: 'string' },
      rendered: { type: 'string' },
      capture: { type: 'string', default: '0.7' },
    },
  });
  if (!values.ocr || !values.dataset || !values.rendered) {
    throw new Error('--ocr, --dataset und --rendered angeben');
  }
  const scads = scadsWords(values.ocr, values.dataset);
  const rendered = renderedWords(values.rendered);
  const capture = Number(values.capture);
  const misread = scads.filter((entry) => entry.misread);
  const read = scads.filter((entry) => !entry.misread);
  const errors = rendered.filter((entry) => entry.error);
  console.log(
    `ScaDS ${scads.length} Wörter, ${misread.length} falsch gelesen; gerendert ${rendered.length} Wörter, ${errors.length} mit Schülerfehler`,
  );
  console.log(
    `| Maß | AUC falsch gegen richtig gelesen | Schwelle für ${100 * capture} % der Lesefehler | richtig gelesen darunter | Schülerfehler darunter |`,
  );
  console.log('| --- | --- | --- | --- | --- |');
  for (const measure of MEASURES) {
    const low = misread.map((entry) => entry.word.scores[measure]).toSorted((a, b) => a - b);
    const high = read.map((entry) => entry.word.scores[measure]);
    const threshold = low[Math.floor(low.length * capture)] ?? 1;
    const student = errors.map((entry) => entry.word.scores[measure]);
    console.log(
      `| ${measure} | ${auc(low, high).toFixed(3)} | ${threshold.toFixed(2)} | ${share(high, threshold)} | ${share(student, threshold)} |`,
    );
  }
  console.log(
    '| Wortlänge | Wörter ScaDS | falsch gelesen | Lesefehler < 0,95 | richtig gelesen < 0,95 | Schülerfehler < 0,95 |',
  );
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const [from, to] of [
    [1, 3],
    [4, 6],
    [7, 10],
    [11, Infinity],
  ] as const) {
    const fits = (entry: { word: WordScore }) =>
      entry.word.length >= from && entry.word.length <= to;
    const bin = scads.filter(fits);
    const minOf = (entries: readonly { word: WordScore }[]) =>
      entries.map((entry) => entry.word.scores.min);
    console.log(
      `| ${from}–${to === Infinity ? '' : to} | ${bin.length} | ${share(
        bin.map((entry) => (entry.misread ? 0 : 1)),
        0.5,
      )} | ${share(minOf(bin.filter((entry) => entry.misread)), 0.95)} | ${share(
        minOf(bin.filter((entry) => !entry.misread)),
        0.95,
      )} | ${share(minOf(errors.filter(fits)), 0.95)} |`,
    );
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  }
}
