import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { buildCorrectedPdf } from '../export/build-pdf.ts';
import { installCanvas, napi } from '../export/test-support.ts';
import type { Transcript } from '../annotations/transcript.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { locateLines } from '../layout/locate-lines.ts';
import { createLlmEngine } from '../llm/engine.ts';
import { fitWithin } from '../llm/image.ts';
import { CACHE, GIB, MODELS_DIR, NodeSidecar } from '../llm/node-sidecar.ts';
import { createSidecarCorrector } from '../llm/sidecar-corrector.ts';
import { defaultCorrector, recommendModel } from '../models/registry.ts';
import type { ReadingHint } from '../correction/uncertain-reading.ts';
import { rasterizeAnnotatedPage } from '../overlay/draw-canvas.ts';
import { layoutHints, markText } from '../overlay/hint-layout.ts';
import { layoutOverlay } from '../overlay/layout.ts';
import { noDiagnostics } from '../pipeline/diagnostics.ts';
import { createLlmTranscriber } from '../pipeline/llm-transcriber.ts';
import { createRunner } from '../pipeline/runner.ts';
import { createReviewExport } from './export-input.ts';
import { createReviewFlow, type ReviewPhase } from './review-flow.ts';

vi.mock('../import/canvas.ts', () =>
  import('../export/test-support.ts').then((m) => m.canvasModule),
);
vi.mock('../overlay/font.ts', () => import('../export/test-support.ts').then((m) => m.fontModule));

const ENABLED = process.env['ROTSTIFT_INTEGRATION'] === '1';
const DATASET =
  process.env['ROTSTIFT_DATASET'] ?? join(CACHE, 'datasets', 'scads-fullpage', 'extracted');
const NAMES = (process.env['ROTSTIFT_E2E_PAGES'] ?? '000,001').split(',');
const OUT = process.env['ROTSTIFT_E2E_OUT'] ?? join(tmpdir(), 'rotstift-e2e');
const PREVIEW_EDGE = 1200;

const transcriber = recommendModel();
const corrector = defaultCorrector();

const imagePath = (name: string) => join(DATASET, 'images', `${name}.jpg`);

const available =
  ENABLED &&
  NAMES.every((name) => existsSync(imagePath(name))) &&
  [transcriber.files.model, transcriber.files.mmproj, corrector.files.model].every((file) =>
    existsSync(join(MODELS_DIR, file.name)),
  );

async function decode(blob: Blob) {
  return napi.loadImage(Buffer.from(await blob.arrayBuffer()));
}

async function modelImage(png: Blob, maxEdge: number): Promise<string> {
  const image = await decode(png);
  const size = fitWithin(image, maxEdge);
  const canvas = napi.createCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(image, 0, 0, size.width, size.height);
  return `data:image/jpeg;base64,${canvas.toBuffer('image/jpeg', 90).toString('base64')}`;
}

async function rgba(blob: Blob) {
  const image = await decode(blob);
  const canvas = napi.createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

async function withHints(
  png: Blob,
  page: { width: number },
  transcript: Transcript,
  hints: readonly ReadingHint[],
): Promise<Uint8Array> {
  const image = await decode(png);
  const canvas = napi.createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const scale = image.width / page.width;
  context.strokeStyle = '#5f6368';
  context.fillStyle = '#5f6368';
  context.lineCap = 'round';
  for (const spot of layoutHints(transcript, hints)) {
    if (spot.status !== 'open') continue;
    const width = Math.max(1.5, spot.height * 0.05 * scale);
    context.lineWidth = width;
    context.setLineDash([width, width * 2]);
    context.beginPath();
    context.moveTo(spot.x * scale, spot.underline * scale);
    context.lineTo((spot.x + spot.width) * scale, spot.underline * scale);
    context.stroke();
    context.font = `${Math.max(9, spot.height * 0.35 * scale)}px sans-serif`;
    context.fillText(
      markText(spot.mark).replaceAll(/[„“]/gu, '"').replace('→', '->'),
      spot.x * scale,
      (spot.y - spot.height * 0.05) * scale,
    );
  }
  return new Uint8Array(canvas.toBuffer('image/png'));
}

const sidecar = new NodeSidecar();
let peakNode = 0;
const nodeSampler = setInterval(() => {
  peakNode = Math.max(peakNode, process.memoryUsage().rss);
}, 200);

beforeAll(() => {
  installCanvas();
  Object.assign(globalThis, { DOMParser: new Window().DOMParser });
});

afterAll(async () => {
  clearInterval(nodeSampler);
  await sidecar.stop();
});

const seconds = (ms: number) => (ms / 1000).toFixed(1);
const gigabytes = (bytes: number | undefined) => ((bytes ?? 0) / GIB).toFixed(2);

describe.skipIf(!available)('Berichtigen end to end with the real sidecar', () => {
  it(
    'transcribes, locates, corrects with Gemma and exports the corrected Arbeit',
    async () => {
      const jpegs = new Map(
        NAMES.map((name) => [
          name,
          new Blob([readFileSync(imagePath(name))], { type: 'image/jpeg' }),
        ]),
      );
      const blobOf = (id: string) => {
        const blob = jpegs.get(id);
        if (blob === undefined) throw new Error(`no image ${id}`);
        return blob;
      };
      const pages: ImportPage[] = await Promise.all(
        NAMES.map(async (name) => {
          const image = await decode(blobOf(name));
          return {
            id: name,
            fileKey: name,
            label: `${name}.jpg`,
            source: { kind: 'image', file: new File([blobOf(name)], `${name}.jpg`) },
            width: image.width,
            height: image.height,
            rotation: 0,
            thumbnailUrl: '',
          };
        }),
      );

      const engine = createLlmEngine(sidecar);
      const runner = createRunner({
        render: (page) => Promise.resolve(blobOf(page.id)),
        diagnostics: noDiagnostics,
      });
      runner.setTranscriber(
        createLlmTranscriber({ client: sidecar, engine, model: transcriber, encode: modelImage }),
      );
      runner.setPages(pages);
      const flow = createReviewFlow({
        transcription: runner,
        loadImage: async (page) => {
          const blob = blobOf(page.id);
          const image = await decode(blob);
          return { blob, width: image.width, height: image.height };
        },
        locator: {
          locate: async (image, lines) => {
            if (!(image instanceof Blob)) throw new TypeError('expected a blob');
            return locateLines(await rgba(image), lines);
          },
        },
      });
      flow.setCorrector(createSidecarCorrector(corrector, { engine, client: sidecar }));

      const phases = new Map<ReviewPhase, number>();
      let current: ReviewPhase | null = null;
      let since = performance.now();
      const unsubscribe = flow.subscribe(() => {
        const phase = flow.getState().run?.phase ?? null;
        if (phase === current) return;
        const now = performance.now();
        if (current !== null) phases.set(current, (phases.get(current) ?? 0) + now - since);
        current = phase;
        since = now;
      });
      const started = performance.now();
      await flow.start(pages, DEUTSCH);
      const total = performance.now() - started;
      unsubscribe();

      const state = flow.getState();
      for (const page of pages) {
        const review = state.pages[page.id];
        expect(review?.status, `${page.id}: ${review?.message ?? ''} ${review?.detail ?? ''}`).toBe(
          'done',
        );
      }

      const transcriberEvents = sidecar.events.flatMap((event, index) =>
        event === `complete ${transcriber.id}` ? [index] : [],
      );
      const correctorStart = sidecar.events.indexOf(`start ${corrector.id}`);
      expect(transcriberEvents).toHaveLength(pages.length);
      expect(correctorStart).toBeGreaterThan(Math.max(...transcriberEvents));
      expect(sidecar.events.filter((event) => event.startsWith('start '))).toEqual([
        `start ${transcriber.id}`,
        `start ${corrector.id}`,
      ]);
      expect(sidecar.maxLive).toBe(1);

      mkdirSync(OUT, { recursive: true });
      const report: string[] = [
        `Seiten: ${NAMES.join(', ')}`,
        `Gesamt: ${seconds(total)} s`,
        ...[...phases].map(([phase, ms]) => `Phase ${phase}: ${seconds(ms)} s`),
      ];
      for (const model of [transcriber, corrector]) {
        const starts = (sidecar.startSeconds.get(model.id) ?? []).map((value) => value.toFixed(1));
        report.push(
          `${model.id}: Start ${starts.join(' / ')} s, Peak-RSS ${gigabytes(sidecar.peakBytes.get(model.id))} GB`,
        );
      }

      for (const page of pages) {
        expect(runner.getState().entries[page.id]?.reading?.lines.flat().length).toBeGreaterThan(0);
        const result = state.pages[page.id]?.result;
        if (result === undefined || result === null) throw new Error(`no result for ${page.id}`);
        const marks = result.transcript.lines.reduce((sum, line) => sum + line.marks.length, 0);
        const located = result.transcript.lines.filter((line) => line.bbox !== undefined).length;
        const model = layoutOverlay(result.transcript, {
          page: { width: page.width, height: page.height },
          profile: DEUTSCH,
        });
        const png = await rasterizeAnnotatedPage({
          image: await createImageBitmap(blobOf(page.id)),
          model,
          type: 'image/png',
          maxEdge: PREVIEW_EDGE,
        });
        writeFileSync(
          join(OUT, `${page.id}.png`),
          await withHints(png, page, result.transcript, result.hints),
        );
        report.push(
          `${page.id}: ${marks} Markierungen, ${result.hints.length} Hinweise unsicher gelesen, ${result.statistics.words} Wörter, ${located}/${result.transcript.lines.length} Zeilen verortet, ${model.items.length} Notizen gezeichnet, ${result.droppedMarks} verworfen`,
        );
      }

      const exporter = createReviewExport();
      const arbeit: Arbeit = { id: 'e2e', name: 'Berichtigen E2E', pages };
      const input = exporter.correctedArbeit(arbeit, state, runner.getState().entries, DEUTSCH);
      if (input === null) throw new Error('the Arbeit is not exportable');
      const exportStarted = performance.now();
      const pdf = await buildCorrectedPdf(input, { encodePage: exporter.encodePage });
      writeFileSync(join(OUT, 'berichtigt.pdf'), pdf);
      report.push(
        `PDF: ${(pdf.byteLength / 1024).toFixed(0)} KB in ${seconds(performance.now() - exportStarted)} s`,
        `Peak-RSS Node: ${gigabytes(peakNode)} GB`,
      );
      expect(pdf.byteLength).toBeGreaterThan(1000);

      writeFileSync(join(OUT, 'bericht.txt'), `${report.join('\n')}\n`);
      process.stdout.write(`\n${report.join('\n')}\nAusgabe: ${OUT}\n`);
    },
    60 * 60 * 1000,
  );
});
