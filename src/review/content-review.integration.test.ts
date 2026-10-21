import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import type { CorrectionScope } from '../correction/scope.ts';
import { buildCorrectedPdf } from '../export/build-pdf.ts';
import { installCanvas, napi, syntheticScan } from '../export/test-support.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { locateLines } from '../layout/locate-lines.ts';
import { createLlmEngine } from '../llm/engine.ts';
import { fitWithin } from '../llm/image.ts';
import { MODELS_DIR, NodeSidecar } from '../llm/node-sidecar.ts';
import { createSidecarCorrector } from '../llm/sidecar-corrector.ts';
import { defaultCorrector, recommendModel } from '../models/registry.ts';
import { rasterizeAnnotatedPage } from '../overlay/draw-canvas.ts';
import { layoutOverlay } from '../overlay/layout.ts';
import { noDiagnostics } from '../pipeline/diagnostics.ts';
import { createLlmTranscriber } from '../pipeline/llm-transcriber.ts';
import { createRunner } from '../pipeline/runner.ts';
import { buildArbeitModel } from './arbeit-model.ts';
import { createReviewExport } from './export-input.ts';
import { createReviewFlow, reviewWorks, type ContentReviewLog } from './review-flow.ts';

vi.mock('../import/canvas.ts', () =>
  import('../export/test-support.ts').then((m) => m.canvasModule),
);
vi.mock('../overlay/font.ts', () => import('../export/test-support.ts').then((m) => m.fontModule));

const ENABLED = process.env['ROTSTIFT_INTEGRATION'] === '1';
const OUT = process.env['ROTSTIFT_E2E_OUT'] ?? join(tmpdir(), 'rotstift-content-e2e');

const transcriber = recommendModel();
const corrector = defaultCorrector();
const available =
  ENABLED &&
  [transcriber.files.model, transcriber.files.mmproj, corrector.files.model].every((file) =>
    existsSync(join(MODELS_DIR, file.name)),
  );

const TEXT = [
  'Ich habe jetzt endlich zwei Wochen Praktikum hinter mir',
  'und wollte dir unbedingt davon erzählen. Ich war in der',
  'Tischlerei Brandt bei uns im Ort, die kennst du bestimt.',
  'Am ersten Tag musste ich schon um sieben Uhr da sein, das',
  'war ganz schön früh. Der Meister hat mir zuerst die',
  'Werkstatt gezeigt und mir erklärt wie man die Maschinen',
  'sicher bedient. In der zweiten Woche durfte ich mit einem',
  'Gesellen zu einer Kundin fahren und eine Küche einbauen.',
  'Am letzten Tag habe ich ein kleines Vogelhaus gebaut, das',
  'jetzt in unserem Garten hängt. Wie geht es dir und deinem',
  'Hund? Kommt ihr im Sommer wieder an die Ostsee? Ich würde',
  'mich sehr freuen, wenn wir dann zusammen segeln gehen.',
];

const SIZE = { width: 2480, height: 3508 };

const SCOPE: CorrectionScope = {
  spelling: true,
  grammar: true,
  content: true,
  form: true,
  formName: 'Persönlicher Brief',
  assignment:
    'Schreibe deiner Tante Petra einen Brief, in dem du von deinem Betriebspraktikum erzählst. Achte auf die Merkmale eines persönlichen Briefs.',
};

const written: Transcript = {
  lines: TEXT.map((text, index) => ({
    number: index + 1,
    text,
    marks: [],
    bbox: { x: 160, y: 228 + index * 110, width: 1600, height: 76 },
  })),
};

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

const sidecar = new NodeSidecar();

beforeAll(() => {
  installCanvas();
  Object.assign(globalThis, { DOMParser: new Window().DOMParser });
});

afterAll(async () => {
  await sidecar.stop();
});

const seconds = (ms: number) => (ms / 1000).toFixed(1);

describe.skipIf(!available)('Inhalt und Form end to end with the real sidecar', () => {
  it(
    'reviews a self-written letter and draws margin notes and the closing comment',
    async () => {
      const scan = await syntheticScan(SIZE, written, 'jpeg');
      const page: ImportPage = {
        id: 'brief',
        fileKey: 'brief',
        label: 'brief.jpg',
        source: { kind: 'image', file: new File([scan], 'brief.jpg') },
        width: SIZE.width,
        height: SIZE.height,
        rotation: 0,
        thumbnailUrl: '',
      };
      const engine = createLlmEngine(sidecar);
      const runner = createRunner({
        render: () => Promise.resolve(scan),
        diagnostics: noDiagnostics,
      });
      runner.setTranscriber(
        createLlmTranscriber({ client: sidecar, engine, model: transcriber, encode: modelImage }),
      );
      runner.setPages([page]);
      const logs: ContentReviewLog[] = [];
      const flow = createReviewFlow({
        transcription: runner,
        loadImage: () => Promise.resolve({ blob: scan, ...SIZE }),
        locator: {
          locate: async (image, lines) => {
            if (!(image instanceof Blob)) throw new TypeError('expected a blob');
            return locateLines(await rgba(image), lines);
          },
        },
        logReview: (entry) => logs.push(entry),
      });
      const sidecarCorrector = createSidecarCorrector(corrector, { engine, client: sidecar });
      flow.setCorrector(sidecarCorrector);
      flow.setReviewer(sidecarCorrector);
      const arbeit: Arbeit = { id: 'tante-petra', name: 'Brief an Tante Petra', pages: [page] };

      const started = performance.now();
      await flow.start([page], DEUTSCH, SCOPE, reviewWorks([arbeit]));
      const total = performance.now() - started;

      const state = flow.getState();
      const review = state.pages[page.id];
      expect([review?.status, review?.message]).toEqual(['done', null]);
      const work = state.works[arbeit.id];
      expect([work?.status, work?.message]).toEqual(['done', null]);
      expect(logs).toHaveLength(1);
      for (const entry of logs) {
        expect(Object.values(entry).every((value) => typeof value !== 'string')).toBe(true);
      }

      const entries = runner.getState().entries;
      const model = buildArbeitModel(arbeit, state, entries);
      const correction = model.pages[0]?.correction;
      if (correction == null) throw new Error('no correction');
      const overlay = layoutOverlay(correction.transcript, {
        page: SIZE,
        profile: DEUTSCH,
        comments: correction.comments,
        summary: correction.summary,
      });
      mkdirSync(OUT, { recursive: true });
      const png = await rasterizeAnnotatedPage({
        image: await createImageBitmap(scan),
        model: overlay,
        type: 'image/png',
        maxEdge: 1400,
      });
      writeFileSync(join(OUT, 'brief.png'), new Uint8Array(await png.arrayBuffer()));

      const exporter = createReviewExport();
      const input = exporter.correctedArbeit(arbeit, state, entries, DEUTSCH);
      if (input === null) throw new Error('the Arbeit is not exportable');
      const pdf = await buildCorrectedPdf(input, { encodePage: exporter.encodePage });
      writeFileSync(join(OUT, 'brief.pdf'), pdf);

      const roles = overlay.items.flatMap((item) => (item.kind === 'text' ? [item.role] : []));
      const report = [
        `Gesamt: ${seconds(total)} s, Prüfung: ${seconds(logs[0]?.durationMs ?? 0)} s`,
        `Fragen: ${logs[0]?.questions ?? 0}, Kommentare: ${work?.comments.length ?? 0}`,
        ...(work?.comments ?? []).map(
          (comment) => `Z. ${comment.line} ${comment.kind}: ${comment.text}`,
        ),
        `Schlusskommentar: ${model.content?.summary ?? '–'}`,
        `Randnotizen: ${roles.filter((role) => role === 'comment').length}, Zeichen: ${roles.filter((role) => role === 'sign').length}, Schluss: ${roles.filter((role) => role === 'summary').length}`,
        `Marken: ${correction.marks.length}`,
      ];
      writeFileSync(join(OUT, 'bericht.txt'), `${report.join('\n')}\n`);
      process.stdout.write(`\n${report.join('\n')}\nAusgabe: ${OUT}\n`);
    },
    60 * 60 * 1000,
  );
});
