import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEUTSCH } from '../src/annotations/profile.ts';
import { transcriptSchema, type Bbox, type Transcript } from '../src/annotations/transcript.ts';
import { correctPage } from '../src/correction/correct-page.ts';
import { createLlmCorrector } from '../src/correction/llm-corrector.ts';
import {
  applyDewarp,
  planDewarp,
  toSource,
  toSourceBox,
  type DewarpPlan,
} from '../src/layout/dewarp.ts';
import { readJpeg } from '../src/layout/image-files.ts';
import { locateLines } from '../src/layout/locate-lines.ts';
import { findStruckWords } from '../src/layout/strike.ts';
import { iou } from '../src/layout/synthetic.ts';
import type { RgbaImage } from '../src/layout/types.ts';
import type { LlmClient } from '../src/llm/client.ts';
import { correctorConfig } from '../src/llm/sidecar-corrector.ts';
import { estimateTextWidth } from '../src/overlay/char-width.ts';
import { layoutOverlay } from '../src/overlay/layout.ts';
import { marginsOf } from '../src/overlay/margins.ts';
import type { PageMargins } from '../src/overlay/model.ts';
import { parseTranscript } from '../src/pipeline/transcript-lines.ts';
import { installDom } from './dom.ts';
import { characterEdits, editDistance, wordEdits } from './metrics.ts';
import { corrector, localFile } from './ocr-registry.ts';
import type { OcrRun } from './ocr-run.ts';
import { launchServer, postJson, record } from './server.ts';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TruthLine {
  text: string;
  bbox: [number, number, number, number] | null;
}

interface PageMeta {
  paper?: string;
  look?: string;
  size?: [number, number];
  margin?: { left: [number, number][]; right: [number, number][] | null };
  lines?: TruthLine[];
}

export interface MarkStats {
  marks: number;
  unplaced: number;
  strokes: number;
  strokesOnLine: number;
  codes: number;
  codesInRand: number;
  codesInRandFit: number;
  codesOverText: number;
  codesOverTextFit: number;
  codesChecked: number;
  codesAny: number;
  codesAnyOverText: number;
  codesAnyOverTextFit: number;
  rightLine: number;
  markLines: number;
}

export interface PageStats {
  name: string;
  group: string;
  words: number;
  wordEdits: number;
  chars: number;
  charEdits: number;
  lines: number;
  located: number;
  matched: number;
  hits: number;
  confidentWrong: number;
  iouSum: number;
  alarms: number;
  crashed: boolean;
  seconds: number;
  rough?: number;
  roughHits?: number;
  ruling?: string;
  expectedRuling?: string;
  locateMs?: number;
  straightened?: boolean;
  dewarpMs?: number;
  marks?: MarkStats;
  marksBefore?: MarkStats;
  drawnMargin?: boolean;
}

const ZERO_MARKS: MarkStats = {
  marks: 0,
  unplaced: 0,
  strokes: 0,
  strokesOnLine: 0,
  codes: 0,
  codesInRand: 0,
  codesInRandFit: 0,
  codesOverText: 0,
  codesOverTextFit: 0,
  codesChecked: 0,
  codesAny: 0,
  codesAnyOverText: 0,
  codesAnyOverTextFit: 0,
  rightLine: 0,
  markLines: 0,
};

const MATCH_LIMIT = 0.45;
const HIT = 0.5;
const WRONG = 0.2;

function folded(text: string): string[] {
  return Array.from(text.toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, ''));
}

export function matchLines(lines: readonly string[], truth: readonly TruthLine[]): number[] {
  const taken = new Set<number>();
  const candidates = lines.flatMap((line, index) => {
    const a = folded(line);
    if (a.length < 3) return [];
    return truth.flatMap((entry, at) => {
      const b = folded(entry.text);
      if (entry.bbox === null || b.length < 3) return [];
      return [{ index, at, cost: editDistance(a, b) / Math.max(a.length, b.length) }];
    });
  });
  const result = lines.map(() => -1);
  for (const candidate of candidates.toSorted((p, q) => p.cost - q.cost)) {
    if (candidate.cost > MATCH_LIMIT) break;
    if (result[candidate.index] !== -1 || taken.has(candidate.at)) continue;
    result[candidate.index] = candidate.at;
    taken.add(candidate.at);
  }
  return result;
}

function scaled(bbox: [number, number, number, number], factor: number): Box {
  const [x, y, width, height] = bbox;
  return { x: x * factor, y: y * factor, width: width * factor, height: height * factor };
}

function edgeAt(edge: [number, number][] | null | undefined, y: number, factor: number) {
  const [top, bottom] = edge ?? [];
  if (top === undefined || bottom === undefined) return null;
  const share = (y / factor - top[1]) / Math.max(1, bottom[1] - top[1]);
  return (top[0] + (bottom[0] - top[0]) * share) * factor;
}

function pathCenter(d: string): { x: number; y: number } {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
  let x = 0;
  let y = 0;
  let count = 0;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    x += numbers[i] ?? 0;
    y += numbers[i + 1] ?? 0;
    count += 1;
  }
  return { x: x / Math.max(1, count), y: y / Math.max(1, count) };
}

function markStats(
  transcript: Transcript,
  width: number,
  height: number,
  matches: readonly number[],
  meta: PageMeta,
  factor: number,
  margins: PageMargins | undefined,
): MarkStats {
  const stats = { ...ZERO_MARKS };
  const overlay = layoutOverlay(transcript, {
    page: { width, height },
    profile: DEUTSCH,
    ...(margins && { margins }),
  });
  const truth = meta.lines ?? [];
  stats.marks = transcript.lines.reduce((sum, line) => sum + line.marks.length, 0);
  stats.unplaced = transcript.lines
    .filter((line) => line.bbox === undefined)
    .reduce((sum, line) => sum + line.marks.length, 0);
  const rightLine = new Set<number>();
  for (const line of transcript.lines) {
    if (line.marks.length === 0 || line.bbox === undefined || truth.length === 0) continue;
    const at = matches[line.number - 1] ?? -1;
    const entry = truth[at];
    if (entry?.bbox === null || entry === undefined) continue;
    stats.markLines += 1;
    if (iou(line.bbox, scaled(entry.bbox, factor)) >= HIT) rightLine.add(line.number);
  }
  stats.rightLine = rightLine.size;
  const boxes = truth.flatMap((entry) => (entry.bbox === null ? [] : [scaled(entry.bbox, factor)]));
  for (const item of overlay.items) {
    const at = matches[item.line - 1] ?? -1;
    const entry = truth[at];
    if (item.kind === 'stroke') {
      if (entry?.bbox === null || entry === undefined) continue;
      stats.strokes += 1;
      const box = scaled(entry.bbox, factor);
      const center = pathCenter(item.d);
      if (
        center.y >= box.y - 0.3 * box.height &&
        center.y <= box.y + 1.3 * box.height &&
        center.x >= box.x - 0.1 * box.width &&
        center.x <= box.x + 1.1 * box.width
      ) {
        stats.strokesOnLine += 1;
      }
    } else if (item.role === 'code') {
      stats.codesAny += 1;
      const left = meta.margin ? edgeAt(meta.margin.left, item.y, factor) : null;
      const right = meta.margin ? edgeAt(meta.margin.right, item.y, factor) : null;
      if (left !== null) {
        stats.codes += 1;
        stats.codesChecked += 1;
      }
      for (const wide of [true, false]) {
        const textWidth = wide
          ? item.text.length * item.size * 0.55
          : estimateTextWidth(item.text, item.size);
        const half = textWidth / 2;
        const center =
          item.anchor === 'start' ? item.x + half : item.anchor === 'end' ? item.x - half : item.x;
        const box = {
          x: center - half,
          y: item.y - item.size * 0.8,
          width: textWidth,
          height: item.size,
        };
        const over = boxes.some((truthBox) => overlaps(box, truthBox));
        const inside =
          left !== null &&
          (center + half <= left + 2 || (right !== null && center - half >= right - 2));
        if (wide) {
          if (over) stats.codesAnyOverText += 1;
          if (over && left !== null) stats.codesOverText += 1;
          if (inside) stats.codesInRand += 1;
        } else {
          if (over) stats.codesAnyOverTextFit += 1;
          if (over && left !== null) stats.codesOverTextFit += 1;
          if (inside) stats.codesInRandFit += 1;
        }
      }
    }
  }
  return stats;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function straighten(image: RgbaImage): { plan: DewarpPlan | null; work: RgbaImage; ms: number } {
  const started = performance.now();
  const plan = planDewarp(image);
  const work = plan === null ? image : applyDewarp(image, plan);
  return { plan, work, ms: performance.now() - started };
}

function sourceMargins(margins: PageMargins, plan: DewarpPlan, image: RgbaImage): PageMargins {
  const map = (line: PageMargins['left']) =>
    line && line.map((point) => toSource(plan, point, image));
  return { left: map(margins.left) ?? null, right: map(margins.right) ?? null };
}

function readMeta(dir: string | undefined, name: string): PageMeta {
  if (dir === undefined) return {};
  const file = join(dir, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

function toBboxes(layout: ReturnType<typeof locateLines>, count: number): (Bbox | undefined)[] {
  return Array.from({ length: count }, (_, index) => {
    const location = layout.lines[index];
    if (location === null || location === undefined) return undefined;
    const { x, y, width, height } = location.bbox;
    if (!(width > 0 && height > 0)) return undefined;
    return { x: Math.max(0, x), y: Math.max(0, y), width, height };
  });
}

async function startCorrector(model: string, threads: number) {
  const info = corrector(model);
  const server = await launchServer({
    model: localFile(info.files.model),
    contextSize: info.server.contextSize,
    threads,
    extraArgs: [
      ...(info.server.cpuRepack ? [] : ['--no-repack']),
      ...(info.server.reasoning === 'off' ? ['--reasoning', 'off'] : []),
    ],
  });
  await server.ready(300_000);
  const client: Pick<LlmClient, 'complete'> = {
    async complete(request) {
      const response = await postJson(server.port, '/v1/chat/completions', request);
      if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
      const json = record(JSON.parse(response.body));
      const choice = record(Array.isArray(json['choices']) ? json['choices'][0] : undefined);
      const content = record(choice['message'])['content'];
      return {
        text: typeof content === 'string' ? content : '',
        finishReason: typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null,
      };
    },
  };
  return {
    server,
    correct: (lines: string[], bboxes: (Bbox | undefined)[]) =>
      correctPage({
        lines,
        bboxes,
        profile: DEUTSCH,
        corrector: createLlmCorrector({ client, config: correctorConfig(info) }),
      }),
  };
}

export function expectedRuling(paper: string | undefined): string {
  if (paper === undefined) return 'blank';
  return paper.startsWith('kariert') ? 'grid' : 'lined';
}

const percent = (part: number, whole: number) =>
  whole === 0 ? '–' : `${((100 * part) / whole).toFixed(1)} %`;

export function summaryRow(label: string, pages: readonly PageStats[]): string {
  const sum = (pick: (page: PageStats) => number) =>
    pages.reduce((total, page) => total + pick(page), 0);
  const marks = pages.flatMap((page) => (page.marks ? [page.marks] : []));
  const markSum = (pick: (stats: MarkStats) => number) =>
    marks.reduce((total, stats) => total + pick(stats), 0);
  const words = sum((page) => page.words);
  const matched = sum((page) => page.matched);
  const lines = sum((page) => page.lines);
  const strokes = markSum((stats) => stats.strokes);
  const codes = markSum((stats) => stats.codesChecked);
  const markLines = markSum((stats) => stats.markLines);
  const cells = [
    label,
    `${pages.length}${pages.some((page) => page.crashed) ? ` (${pages.filter((page) => page.crashed).length} Absturz)` : ''}`,
    String(words),
    percent(
      sum((page) => page.wordEdits),
      words,
    ),
    percent(
      sum((page) => page.charEdits),
      sum((page) => page.chars),
    ),
    percent(
      sum((page) => page.located),
      lines,
    ),
    matched === 0
      ? '–'
      : percent(
          sum((page) => page.hits),
          matched,
        ),
    matched === 0
      ? '–'
      : percent(
          sum((page) => page.confidentWrong),
          matched,
        ),
    ((100 * sum((page) => page.alarms)) / Math.max(1, words)).toFixed(2),
    marks.length === 0
      ? '–'
      : ((100 * markSum((stats) => stats.marks)) / Math.max(1, words)).toFixed(1),
    marks.length === 0
      ? '–'
      : percent(
          markSum((stats) => stats.unplaced),
          markSum((stats) => stats.marks),
        ),
    markLines === 0
      ? '–'
      : percent(
          markSum((stats) => stats.rightLine),
          markLines,
        ),
    strokes === 0
      ? '–'
      : percent(
          markSum((stats) => stats.strokesOnLine),
          strokes,
        ),
    codes === 0
      ? '–'
      : percent(
          markSum((stats) => stats.codesInRand),
          codes,
        ),
    codes === 0
      ? '–'
      : percent(
          markSum((stats) => stats.codesOverText),
          codes,
        ),
  ];
  return `| ${cells.join(' | ')} |`;
}

export function layoutRow(label: string, pages: readonly PageStats[]): string {
  const sum = (pick: (page: PageStats) => number) =>
    pages.reduce((total, page) => total + pick(page), 0);
  const matched = sum((page) => page.matched);
  const crashes = pages.filter((page) => page.crashed).length;
  const timed = pages.filter((page) => page.locateMs !== undefined);
  const cells = [
    label,
    `${pages.length}${crashes > 0 ? ` (${crashes} Absturz)` : ''}`,
    percent(
      sum((page) => page.located),
      sum((page) => page.lines),
    ),
    percent(
      sum((page) => page.rough ?? 0),
      sum((page) => page.lines),
    ),
    matched === 0
      ? '–'
      : percent(
          sum((page) => page.hits),
          matched,
        ),
    matched === 0
      ? '–'
      : percent(
          sum((page) => page.confidentWrong),
          matched,
        ),
    percent(pages.filter((page) => page.ruling === page.expectedRuling).length, pages.length),
    timed.length === 0
      ? '–'
      : (timed.reduce((total, page) => total + (page.locateMs ?? 0), 0) / timed.length).toFixed(0),
  ];
  return `| ${cells.join(' | ')} |`;
}

function stat(stats: MarkStats | undefined, field: string): number {
  const found = Object.entries(stats ?? {}).find(([key]) => key === field)?.[1];
  return typeof found === 'number' ? found : 0;
}

export function marksRow(label: string, pages: readonly PageStats[], fit = false): string {
  const suffix = fit ? 'Fit' : '';
  const total = (pick: 'marks' | 'marksBefore', field: string) =>
    pages.reduce((sum, page) => sum + stat(page[pick], field), 0);
  const cell = (field: string, base: string) =>
    [total('marksBefore', field), total('marks', field)].map((count, index) =>
      percent(count, total(index === 0 ? 'marksBefore' : 'marks', base)),
    );
  const [inBefore, inAfter] = cell(`codesInRand${suffix}`, 'codesChecked');
  const [overBefore, overAfter] = cell(`codesOverText${suffix}`, 'codesChecked');
  const [anyBefore, anyAfter] = cell(`codesAnyOverText${suffix}`, 'codesAny');
  const cells = [
    label,
    String(total('marks', 'codesChecked')),
    inBefore,
    inAfter,
    overBefore,
    overAfter,
    String(total('marks', 'codesAny')),
    anyBefore,
    anyAfter,
  ];
  return `| ${cells.join(' | ')} |`;
}

export const MARKS_HEADER = [
  '| Gruppe | Randzeichen mit Rand | im Rand vorher | im Rand nachher | über Text vorher | über Text nachher | Randzeichen alle Seiten | über Text vorher (alle) | über Text nachher (alle) |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
].join('\n');

export const LAYOUT_HEADER = [
  '| Gruppe | Seiten | Zeilen mit Box | davon grob | Box trifft (IoU ≥ 0,5) | Box sicher falsch | Papier erkannt | ms je Seite |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
].join('\n');

export const SUMMARY_HEADER = [
  '| Gruppe | Seiten | Wörter | WER | CER | Zeilen mit Box | Box trifft (IoU ≥ 0,5) | Box sicher falsch | Strich-Alarme je 100 Wörter | Marken je 100 Wörter | Marken ohne Box | Markenzeile richtig | Striche auf der Zeile | Randzeichen im Heftrand | Randzeichen über Text |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
].join('\n');

async function main() {
  installDom();
  const { values } = parseArgs({
    options: {
      ocr: { type: 'string' },
      ideal: { type: 'boolean', default: false },
      images: { type: 'string' },
      originals: { type: 'string' },
      truth: { type: 'string' },
      lines: { type: 'string' },
      label: { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string', default: 'gemma-4-e2b-q4' },
      threads: { type: 'string', default: '6' },
      marks: { type: 'boolean', default: false },
      transcripts: { type: 'string' },
      'no-wer': { type: 'boolean', default: false },
      paper: { type: 'string' },
      dewarp: { type: 'boolean', default: false },
    },
  });
  if ((!values.ocr && !values.ideal) || !values.images || !values.truth || !values.out) {
    throw new Error('--ocr (oder --ideal), --images, --truth und --out angeben');
  }
  const truthDir = values.truth;
  const run: OcrRun =
    values.ocr && !values.ideal
      ? JSON.parse(readFileSync(values.ocr, 'utf8'))
      : {
          model: 'ideal',
          machine: '',
          threads: 0,
          imageMaxEdge: 0,
          peakRssBytes: 0,
          pages: readdirSync(values.images)
            .filter((file) => file.endsWith('.jpg'))
            .toSorted()
            .map((file) => {
              const name = file.slice(0, -'.jpg'.length);
              const truthLines = readMeta(values.lines, name).lines;
              return {
                name,
                content:
                  truthLines === undefined
                    ? readFileSync(join(truthDir, `${name}.txt`), 'utf8')
                    : truthLines.map((line) => line.text).join('\n'),
                finishReason: 'stop',
                seconds: 0,
                promptTokens: 0,
                generatedTokens: 0,
                tokens: [],
              };
            }),
        };
  const done: PageStats[] = existsSync(values.out)
    ? JSON.parse(readFileSync(values.out, 'utf8'))
    : [];
  const needsMarks = (page: PageStats) => values.marks && page.marks === undefined;
  const todo = run.pages.filter((page) => {
    const old = done.find((entry) => entry.name === page.name);
    return old === undefined || needsMarks(old);
  });
  let sidecar: Awaited<ReturnType<typeof startCorrector>> | null = null;
  const session = values.marks && todo.length > 0 ? { stop: () => sidecar?.server.stop() } : null;
  const corrected = async (name: string, lines: string[], bboxes: (Bbox | undefined)[]) => {
    const cache = values.transcripts ? join(values.transcripts, `${name}.json`) : null;
    if (cache !== null && existsSync(cache)) {
      return {
        ok: true,
        transcript: transcriptSchema.parse(JSON.parse(readFileSync(cache, 'utf8'))),
      };
    }
    sidecar ??= await startCorrector(values.model, Number(values.threads));
    const result = await sidecar.correct(lines, bboxes);
    if (cache !== null && result.ok) {
      await mkdir(dirname(cache), { recursive: true });
      await writeFile(cache, JSON.stringify(result.transcript));
    }
    return result;
  };
  try {
    for (const page of todo) {
      const truthFile = join(values.truth, `${page.name}.txt`);
      const imageFile = join(values.images, `${page.name}.jpg`);
      if (!existsSync(truthFile) || !existsSync(imageFile)) continue;
      const meta = readMeta(values.lines, page.name);
      const lines = parseTranscript(page.content.replaceAll('~~', '')).lines;
      const image = readJpeg(imageFile);
      const truthText = readFileSync(truthFile, 'utf8').replaceAll(/~~\S+~~/gu, '');
      const hypothesis = lines.join('\n');
      const factor = meta.size ? image.width / meta.size[0] : 1;
      const straight = values.dewarp ? straighten(image) : null;
      const work = straight?.work ?? image;
      let crashed = false;
      const started = performance.now();
      const located: ReturnType<typeof locateLines> = (() => {
        try {
          return locateLines(work, lines);
        } catch (error) {
          crashed = true;
          console.log(`${page.name}: Zeilenzuordnung abgestürzt (${String(error)})`);
          return { lines: lines.map(() => null), skewDegrees: 0, detectedLines: 0 };
        }
      })();
      const locateMs = performance.now() - started;
      const plan = straight?.plan ?? null;
      const layout =
        plan === null
          ? located
          : {
              ...located,
              lines: located.lines.map((line) =>
                line == null ? line : { ...line, bbox: toSourceBox(plan, line.bbox, image) },
              ),
            };
      const matches = meta.lines ? matchLines(lines, meta.lines) : lines.map(() => -1);
      let matched = 0;
      let hits = 0;
      let confidentWrong = 0;
      let roughHits = 0;
      let iouSum = 0;
      lines.forEach((_, index) => {
        const at = matches[index] ?? -1;
        const entry = meta.lines?.[at];
        if (entry?.bbox == null) return;
        matched += 1;
        const found = layout.lines[index];
        if (found === null || found === undefined) return;
        const overlap = iou(found.bbox, scaled(entry.bbox, factor));
        iouSum += overlap;
        if (overlap >= HIT) hits += 1;
        if (found.rough === true) {
          if (overlap >= HIT) roughHits += 1;
        } else if (overlap < WRONG) {
          confidentWrong += 1;
        }
      });
      let struck: number[][] = [];
      try {
        struck = findStruckWords(work, lines).map((words) => [...words]);
      } catch (error) {
        crashed = true;
        console.log(`${page.name}: Strichsuche abgestürzt (${String(error)})`);
      }
      const wordCount = wordEdits(truthText, hypothesis);
      const charCount = characterEdits(truthText, hypothesis);
      const stats: PageStats = {
        name: page.name,
        group: meta.paper ? `${meta.paper}-${meta.look}` : 'alle',
        words: wordCount.total,
        wordEdits: values['no-wer'] ? 0 : wordCount.edits,
        chars: charCount.total,
        charEdits: values['no-wer'] ? 0 : charCount.edits,
        lines: lines.filter((line) => line.trim() !== '').length,
        located: layout.lines.filter(
          (line, index) => line != null && (lines[index] ?? '').trim() !== '',
        ).length,
        matched,
        hits,
        confidentWrong,
        iouSum,
        alarms: struck.reduce((sum, words) => sum + words.length, 0),
        crashed,
        seconds: page.seconds,
        rough: layout.lines.filter(
          (line, index) => line?.rough === true && (lines[index] ?? '').trim() !== '',
        ).length,
        roughHits,
        ruling: layout.ruling?.kind ?? 'blank',
        expectedRuling: expectedRuling(values.paper ?? meta.paper),
        locateMs,
        drawnMargin: meta.margin?.right != null && meta.paper !== 'liniert-eng',
        ...(straight === null ? {} : { straightened: plan !== null, dewarpMs: straight.ms }),
      };
      if (session !== null) {
        const bboxes = toBboxes(layout, lines.length);
        const result = await corrected(page.name, lines, bboxes);
        if (result.ok) {
          const found = marginsOf(located.ruling);
          const margins = plan === null ? found : found && sourceMargins(found, plan, image);
          const measure = (used: PageMargins | undefined) =>
            markStats(result.transcript, image.width, image.height, matches, meta, factor, used);
          stats.marks = measure(margins);
          stats.marksBefore = measure(undefined);
        }
      }
      const at = done.findIndex((entry) => entry.name === page.name);
      if (at >= 0) done.splice(at, 1, stats);
      else done.push(stats);
      console.log(`${page.name} ${stats.group} ok`);
      await mkdir(dirname(values.out), { recursive: true });
      await writeFile(values.out, `${JSON.stringify(done)}\n`);
    }
  } finally {
    await session?.stop();
  }
  const groups = [...new Set(done.map((page) => page.group))].toSorted();
  const rows =
    groups.length > 1
      ? groups.map((group) =>
          summaryRow(
            group,
            done.filter((page) => page.group === group),
          ),
        )
      : [];
  console.log(`\n${values.label ?? values.out}\n\n${SUMMARY_HEADER}`);
  console.log([...rows, summaryRow('alle', done)].join('\n'));
  const layoutRows =
    groups.length > 1
      ? groups.map((group) =>
          layoutRow(
            group,
            done.filter((page) => page.group === group),
          ),
        )
      : [];
  if (done.some((page) => page.marksBefore !== undefined)) {
    for (const fit of [false, true]) {
      const markRows = groups.map((group) =>
        marksRow(
          group,
          done.filter((page) => page.group === group),
          fit,
        ),
      );
      console.log(
        `\nRandzeichen, Breite ${fit ? 'nach Breitenmodell der Schrift' : '0,55 em je Zeichen (wie Phase 1)'}\n\n${MARKS_HEADER}`,
      );
      const withMargin = done.filter((page) => page.drawnMargin === true);
      console.log(
        [
          ...markRows,
          marksRow('alle', done, fit),
          marksRow('mit gezeichnetem Rand', withMargin, fit),
        ].join('\n'),
      );
    }
  }
  console.log(`\n${LAYOUT_HEADER}`);
  console.log([...layoutRows, layoutRow('alle', done)].join('\n'));
  const timed = done.flatMap((page) => (page.dewarpMs === undefined ? [] : [page.dewarpMs]));
  if (timed.length > 0) {
    const sorted = timed.toSorted((a, b) => a - b);
    const straightened = done.filter((page) => page.straightened === true).length;
    console.log(
      `\nBegradigt: ${straightened} von ${timed.length} Seiten, Begradigen im Median ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(0)} ms, höchstens ${(sorted.at(-1) ?? 0).toFixed(0)} ms`,
    );
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
