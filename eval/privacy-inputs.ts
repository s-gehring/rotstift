import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { splitTranscript } from '../src/pipeline/transcript-lines.ts';
import { addNoise, learnNoise } from './ocr-noise.ts';
import type { NoiseModel } from './ocr-noise.ts';
import type { OcrRun } from './ocr-run.ts';
import { transferGold } from './privacy-metrics.ts';
import { readSamples } from './privacy-sample.ts';
import { parseArgs } from 'node:util';
import type { DetectorContext, GoldSpan } from './privacy-sample.ts';
import { samplesDir } from './paths.ts';

export const CONDITIONS = ['clean', 'ocr', 'noise1', 'noise2'] as const;
export type Condition = (typeof CONDITIONS)[number];

export function isCondition(value: string): value is Condition {
  return (CONDITIONS as readonly string[]).includes(value);
}

export interface WorkInput {
  id: string;
  condition: Condition;
  lines: string[];
  gold: GoldSpan[];
  context: DetectorContext;
}

export function privacyCache(): string {
  return (
    process.env['ROTSTIFT_PRIVACY_CACHE'] ??
    join(homedir(), '.cache', 'rotstift', 'eval', 'privacy')
  );
}

function ocrPages(set: string): Map<string, string[]> {
  const file = join(privacyCache(), `ocr-${set.split('/').at(-1) ?? set}.json`);
  if (!existsSync(file)) return new Map();
  const run: OcrRun = JSON.parse(readFileSync(file, 'utf8'));
  return new Map(
    run.pages.map((page) => [page.name.split('--')[0] ?? page.name, splitTranscript(page.content)]),
  );
}

export function loadInputs(set: string, conditions: readonly Condition[]): WorkInput[] {
  const samples = readSamples(set.includes('/') ? set : join(samplesDir, 'privacy', set));
  const ocr = ocrPages(set);
  const noiseFile = join(privacyCache(), 'noise.json');
  const noise: NoiseModel | undefined = existsSync(noiseFile)
    ? JSON.parse(readFileSync(noiseFile, 'utf8'))
    : undefined;
  return samples.flatMap((sample, index) => {
    const context: DetectorContext = {
      workName: sample.workName,
      subject: sample.subject,
      language: 'Deutsch',
      ...(sample.task ? { task: sample.task } : {}),
    };
    return conditions.flatMap((condition): WorkInput[] => {
      if (condition === 'clean') {
        return [{ id: sample.id, condition, lines: sample.lines, gold: sample.gold, context }];
      }
      const lines =
        condition === 'ocr'
          ? ocr.get(sample.id)
          : noise && addNoise(sample.lines, noise, 1000 * Number(condition.slice(5)) + index);
      if (!lines) return [];
      return [
        {
          id: sample.id,
          condition,
          lines,
          gold: transferGold(sample.lines, sample.gold, lines),
          context,
        },
      ];
    });
  });
}

function main() {
  const { values } = parseArgs({
    options: { 'noise-from': { type: 'string' }, dataset: { type: 'string' } },
  });
  if (!values['noise-from'] || !values.dataset)
    throw new Error('--noise-from und --dataset angeben');
  const run: OcrRun = JSON.parse(readFileSync(values['noise-from'], 'utf8'));
  const model = learnNoise(
    run.pages.map((page) => ({
      truth: readFileSync(join(values.dataset ?? '', 'ground_truth', `${page.name}.txt`), 'utf8'),
      read: page.content,
    })),
  );
  mkdirSync(privacyCache(), { recursive: true });
  writeFileSync(join(privacyCache(), 'noise.json'), `${JSON.stringify(model)}\n`);
  console.log(`${model.misreadWords} von ${model.words} Wörtern falsch gelesen`);
}

if (import.meta.main) main();
