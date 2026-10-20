import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { wilson } from './correct-report.ts';
import { goldFromMarkup } from './gold.ts';
import { calibrationTable } from './ocr-calibration.ts';
import type { CorrectRun } from './ocr-correct.ts';
import { transcriber } from './ocr-registry.ts';
import type { OcrRun } from './ocr-run.ts';
import { chooseThreshold, readingErrorRate, recallDocs, writtenLines } from './ocr-score.ts';
import type { ThresholdRow } from './ocr-score.ts';
import { pageWords } from './ocr-word-measures.ts';
import { evalDir } from './paths.ts';

const IMAGE = new Set(['.jpg', '.jpeg', '.png']);
const DEFAULT_THRESHOLDS = '0.5,0.7,0.8,0.85,0.9,0.95,0.98,0.99';

export interface ScanPage {
  name: string;
  errors: number;
}

export function scanPages(dir: string): ScanPage[] {
  const images = readdirSync(dir).filter((file) => IMAGE.has(extname(file).toLowerCase()));
  if (images.length === 0) throw new Error(`Keine Bilder (.jpg, .jpeg, .png) in ${dir}`);
  return images.toSorted().map((file) => {
    const name = basename(file, extname(file));
    const text = join(dir, `${name}.txt`);
    if (!existsSync(text)) throw new Error(`Zu ${file} fehlt ${name}.txt`);
    const gold = goldFromMarkup(readFileSync(text, 'utf8').trim()).gold;
    return { name, errors: gold.lines.reduce((sum, line) => sum + line.marks.length, 0) };
  });
}

function run(command: string, args: readonly string[]) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} ist fehlgeschlagen`);
}

function node(script: string, args: readonly string[]) {
  run(process.execPath, [...process.execArgv, join(evalDir, script), ...args]);
}

function python(): string {
  const venv = join(evalDir, '.venv', 'bin', 'python');
  return existsSync(venv) ? venv : 'python3';
}

function percent(count: number, total: number): string {
  if (total === 0) return 'n. v.';
  const [low, high] = wilson(count, total);
  return `${((100 * count) / total).toFixed(0)} % (${Math.max(0, 100 * low).toFixed(0)}–${(100 * high).toFixed(0)})`;
}

function per100(count: number, words: number, interval = false): string {
  if (words === 0) return 'n. v.';
  const value = ((100 * count) / words).toFixed(1);
  if (!interval) return value;
  const [low, high] = wilson(count, words);
  return `${value} (${Math.max(0, 100 * low).toFixed(1)}–${(100 * high).toFixed(1)})`;
}

export function thresholdReport(
  model: string,
  ocr: OcrRun,
  corrections: CorrectRun,
  scans: string,
  thresholds: readonly number[],
): string {
  const markupOf = (id: string) => readFileSync(join(scans, `${id}.txt`), 'utf8').trim();
  const truthOf = (name: string) => writtenLines(markupOf(name));
  const errors = readingErrorRate(ocr, truthOf);
  const words = ocr.pages
    .filter((page) => page.finishReason === 'stop')
    .flatMap((page) => pageWords(page, truthOf(page.name)))
    .map((entry) => ({ confidence: entry.word.scores.min, wrong: entry.misread }));
  const configured = transcriber(model).request.uncertainBelow;
  const rows: ThresholdRow[] = [];
  const table = [undefined, ...thresholds].map((threshold) => {
    const score = recallDocs(
      corrections,
      ocr,
      threshold === undefined ? {} : { minConfidence: threshold },
      markupOf,
    );
    if (threshold !== undefined) {
      rows.push({ threshold, alarms: score.cleanAlarms, words: score.cleanWords });
    }
    return `| ${threshold ?? 'keine'} | ${percent(score.matched, score.gold)} | ${percent(score.matchedWithHints, score.gold)} | ${percent(score.matched, score.predicted)} | ${per100(score.uncertain, score.words)} | ${per100(score.cleanAlarms, score.cleanWords, true)} | ${per100(score.cleanUncertain, score.cleanWords)} |`;
  });
  const chosen = chooseThreshold(rows);
  return [
    `## ${model}`,
    '',
    `Lesefehler: Zeichenfehlerrate ${percent(errors.edits, errors.chars)}, falsch gelesene Wörter ${percent(errors.misread, errors.words)} (${errors.misread} von ${errors.words}), ${errors.incomplete} von ${ocr.pages.length} Seiten unvollständig (Wiederholungsschleife), ${(ocr.pages.reduce((sum, page) => sum + page.seconds, 0) / ocr.pages.length).toFixed(1)} s/Seite mit ${ocr.threads} Threads, Peak-RAM ${(ocr.peakRssBytes / 1024 ** 3).toFixed(1)} GiB.`,
    '',
    calibrationTable('Kalibrierung (falsch = anders gelesen als geschrieben)', words),
    '| Schwelle | Recall rote Marken | Recall mit Hinweisen | Precision | Hinweise je 100 Wörter (mit Fehlern) | Fehlalarme je 100 Wörter (fehlerfrei) | Hinweise je 100 Wörter (fehlerfrei) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...table,
    '',
    `Schwelle nach Regel (kleinste, deren Intervall 1 Fehlalarm je 100 Wörter auf den fehlerfreien Seiten erreicht): ${chosen ?? 'keine'}. In der Registry: ${configured ?? 'keine'}.`,
    '',
  ].join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      scans: { type: 'string' },
      models: { type: 'string', default: 'glm-ocr-q8' },
      threads: { type: 'string', default: '8' },
      out: { type: 'string' },
      thresholds: { type: 'string', default: DEFAULT_THRESHOLDS },
    },
  });
  if (!values.scans) throw new Error('--scans <Ordner mit Bildern und .txt> angeben');
  const scans = resolve(values.scans);
  const pages = scanPages(scans);
  const withErrors = pages.filter((page) => page.errors > 0);
  console.log(
    `${pages.length} Seiten, ${withErrors.length} mit zusammen ${withErrors.reduce((sum, page) => sum + page.errors, 0)} Fehlern, ${pages.length - withErrors.length} fehlerfrei`,
  );
  const out = resolve(values.out ?? join(homedir(), '.cache', 'rotstift', 'eval', basename(scans)));
  const thresholds = values.thresholds.split(',').map(Number);
  const sections: string[] = [];
  for (const model of values.models.split(',')) {
    const edge = transcriber(model).request.imageMaxEdge;
    const images = join(out, `bilder-${edge}`);
    const ocrFile = join(out, `ocr-${model}.json`);
    const correctFile = join(out, `korrektur-${model}.json`);
    run(python(), ['-I', join(evalDir, 'resize-pages.py'), scans, images, '--max-edge', `${edge}`]);
    node('ocr-run.ts', [
      '--model',
      model,
      '--images',
      images,
      '--threads',
      values.threads,
      '--out',
      ocrFile,
    ]);
    node('ocr-correct.ts', [
      '--prompt',
      'app',
      '--no-thinking',
      '--ocr',
      ocrFile,
      '--threads',
      values.threads,
      '--out',
      correctFile,
    ]);
    const ocr: OcrRun = JSON.parse(readFileSync(ocrFile, 'utf8'));
    const corrections: CorrectRun = JSON.parse(readFileSync(correctFile, 'utf8'));
    sections.push(thresholdReport(model, ocr, corrections, scans, thresholds));
  }
  const report = [`# Schwellenprüfung ${basename(scans)}`, '', ...sections].join('\n');
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'bericht.md'), report);
  process.stdout.write(`${report}\nBericht: ${join(out, 'bericht.md')}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
