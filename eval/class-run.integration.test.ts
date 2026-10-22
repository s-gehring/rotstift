import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../src/annotations/profile.ts';
import type { CorrectionScope } from '../src/correction/scope.ts';
import { installCanvas, napi } from '../src/export/test-support.ts';
import type { ImportPage } from '../src/import/pages.ts';
import { locateLines } from '../src/layout/locate-lines.ts';
import { createLlmEngine } from '../src/llm/engine.ts';
import { fitWithin } from '../src/llm/image.ts';
import { MODELS_DIR, NodeSidecar } from '../src/llm/node-sidecar.ts';
import { createSidecarCorrector } from '../src/llm/sidecar-corrector.ts';
import {
  CORRECTORS,
  defaultCorrector,
  recommendModel,
  secondReader,
} from '../src/models/registry.ts';
import { noDiagnostics } from '../src/pipeline/diagnostics.ts';
import { createLlmTranscriber } from '../src/pipeline/llm-transcriber.ts';
import { createRunner } from '../src/pipeline/runner.ts';
import { withSecondReading } from '../src/pipeline/second-reading.ts';
import {
  createReviewFlow,
  reviewWorks,
  type ContentReviewLog,
  type ReviewPhase,
} from '../src/review/review-flow.ts';

vi.mock('../src/import/canvas.ts', () =>
  import('../src/export/test-support.ts').then((m) => m.canvasModule),
);

const ENABLED = process.env['ROTSTIFT_INTEGRATION'] === '1';
const CLASS_DIR = process.env['ROTSTIFT_CLASS'] ?? '';
const OUT = process.env['ROTSTIFT_CLASS_OUT'] ?? join(CLASS_DIR, 'results');
const LABEL = process.env['ROTSTIFT_CLASS_LABEL'] ?? 'run';
const CONTENT = process.env['ROTSTIFT_CLASS_CONTENT'] !== '0';
const TEXT_MODEL = process.env['ROTSTIFT_CLASS_TEXT_MODEL'];
const SECOND = process.env['ROTSTIFT_CLASS_SECOND'] === '1';

const transcriber = recommendModel();
const corrector = CORRECTORS.find((model) => model.id === TEXT_MODEL) ?? defaultCorrector();
const second = SECOND ? secondReader() : null;

const available =
  ENABLED &&
  existsSync(CLASS_DIR) &&
  [
    transcriber.files.model,
    transcriber.files.mmproj,
    corrector.files.model,
    ...(second === null ? [] : [second.files.model, second.files.mmproj]),
  ].every((file) => existsSync(join(MODELS_DIR, file.name)));

const SCOPE: CorrectionScope = {
  spelling: true,
  grammar: true,
  content: CONTENT,
  form: CONTENT,
  formName: CONTENT ? 'Persönlicher Brief' : '',
  assignment: CONTENT
    ? 'Schreibe deinem Freund einen Brief, in dem du von deinem Umzug in eine neue Stadt erzählst. Achte auf die Merkmale eines persönlichen Briefs.'
    : '',
};

async function decode(blob: Blob) {
  return napi.loadImage(Buffer.from(await blob.arrayBuffer()));
}

async function modelImage(blob: Blob, maxEdge: number): Promise<string> {
  const image = await decode(blob);
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

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
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

describe.skipIf(!available)('a whole class through the real sidecar', () => {
  it(
    'transcribes, corrects and reviews every Arbeit and records the timings',
    async () => {
      const files = readdirSync(CLASS_DIR)
        .filter((name) => name.endsWith('.jpg'))
        .toSorted();
      const jpegs = new Map(
        files.map((name) => [
          name,
          new Blob([readFileSync(join(CLASS_DIR, name))], { type: 'image/jpeg' }),
        ]),
      );
      const blobOf = (id: string) => {
        const blob = jpegs.get(id);
        if (blob === undefined) throw new Error(`no image ${id}`);
        return blob;
      };
      const pages: ImportPage[] = await Promise.all(
        files.map(async (name) => {
          const image = await decode(blobOf(name));
          return {
            id: name,
            fileKey: name,
            label: name,
            source: { kind: 'image', file: new File([blobOf(name)], name) },
            width: image.width,
            height: image.height,
            rotation: 0,
            thumbnailUrl: '',
          };
        }),
      );
      const arbeiten = new Map<string, ImportPage[]>();
      for (const page of pages) {
        const id = page.id.replace(/-\d+\.jpg$/u, '');
        arbeiten.set(id, [...(arbeiten.get(id) ?? []), page]);
      }

      const stops: number[] = [];
      const stop = sidecar.stop;
      sidecar.stop = async () => {
        const began = performance.now();
        const status = await stop();
        stops.push((performance.now() - began) / 1000);
        return status;
      };

      const engine = createLlmEngine(sidecar);
      const runner = createRunner({
        render: (page) => Promise.resolve(blobOf(page.id)),
        diagnostics: noDiagnostics,
      });
      const primary = createLlmTranscriber({
        client: sidecar,
        engine,
        model: transcriber,
        encode: modelImage,
      });
      runner.setTranscriber(
        second === null
          ? primary
          : withSecondReading(
              primary,
              createLlmTranscriber({ client: sidecar, engine, model: second, encode: modelImage }),
            ),
      );
      runner.setPages(pages);
      const reviews: ContentReviewLog[] = [];
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
        logReview: (entry) => reviews.push(entry),
      });
      const sidecarCorrector = createSidecarCorrector(corrector, { engine, client: sidecar });
      flow.setCorrector(sidecarCorrector);
      flow.setReviewer(sidecarCorrector);

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
      const works = [...arbeiten].map(([id, list]) => ({ id, name: id, pages: list }));
      const started = performance.now();
      await flow.start(pages, DEUTSCH, SCOPE, reviewWorks(works));
      const totalSeconds = (performance.now() - started) / 1000;
      unsubscribe();
      await sidecar.stop();

      const state = flow.getState();
      const statuses = Object.values(state.pages).map((page) => page.status);
      const workStatuses = Object.values(state.works).map((work) => work.status);
      const result = {
        label: LABEL,
        threads: process.env['ROTSTIFT_THREADS'] ?? null,
        noRepack: process.env['ROTSTIFT_NO_REPACK'] ?? null,
        textModel: corrector.id,
        secondReading: second !== null,
        content: CONTENT,
        arbeiten: works.length,
        pages: pages.length,
        totalSeconds,
        phases: Object.fromEntries([...phases].map(([phase, ms]) => [phase, ms / 1000])),
        starts: sidecar.events.filter((event) => event.startsWith('start ')),
        startSeconds: Object.fromEntries(sidecar.startSeconds),
        stopSeconds: stops,
        peakBytes: Object.fromEntries(sidecar.peakBytes),
        peakNodeBytes: peakNode,
        maxLive: sidecar.maxLive,
        pageStatuses: tally(statuses),
        workStatuses: tally(workStatuses),
        reviewSeconds: reviews.map((entry) => entry.durationMs / 1000),
      };
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${LABEL}.json`), `${JSON.stringify(result, null, 2)}\n`);
      process.stdout.write(`\n${JSON.stringify(result)}\n`);

      expect(statuses.every((status) => status === 'done')).toBe(true);
      expect(sidecar.maxLive).toBe(1);
    },
    4 * 60 * 60 * 1000,
  );
});
