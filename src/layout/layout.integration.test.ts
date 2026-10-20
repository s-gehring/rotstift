import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { createLlmTranscriber } from '../pipeline/llm-transcriber.ts';
import truth from './fixtures/rendered-truth.json';
import { readJpeg } from './image-files.ts';
import { locateLines } from './locate-lines.ts';
import { CACHE, MODELS_DIR, model, RealSidecar } from './real-sidecar.ts';
import { paintOver, scoreVariant, sumScores, variantsOf, type VariantScore } from './perturb.ts';
import { iou } from './synthetic.ts';
import type { BBox } from './types.ts';

const ENABLED = process.env['ROTSTIFT_INTEGRATION'] === '1';
const DATASET =
  process.env['ROTSTIFT_DATASET'] ?? join(CACHE, 'datasets', 'scads-fullpage', 'extracted');
const RENDERED =
  process.env['ROTSTIFT_RENDERED'] ??
  join(import.meta.dirname, '..', '..', 'eval', 'samples', 'rendered');
const PAGES = Number(process.env['ROTSTIFT_PAGES'] ?? '3');
const MIN_IOU = 0.5;

interface TruthLine {
  readonly text: string;
  readonly bbox: readonly number[] | null;
}

const pages: Record<string, readonly TruthLine[]> = truth;

function boxOf(bbox: readonly number[] | null): BBox | null {
  if (bbox === null) return null;
  const [x = 0, y = 0, width = 0, height = 0] = bbox;
  return { x, y, width, height };
}

describe.skipIf(!ENABLED || !existsSync(RENDERED))(
  'rendered ruled pages with known line boxes',
  () => {
    it('assigns every line with an IoU of at least 0.5', () => {
      const rows: string[] = [];
      let hits = 0;
      let total = 0;
      let sum = 0;
      let elapsed = 0;
      for (const [name, lines] of Object.entries(pages)) {
        const image = readJpeg(join(RENDERED, `${name}.jpg`));
        const started = performance.now();
        const result = locateLines(
          image,
          lines.map((line) => line.text),
        );
        elapsed += performance.now() - started;
        let pageHits = 0;
        let pageTotal = 0;
        lines.forEach((line, index) => {
          const box = boxOf(line.bbox);
          if (box === null) return;
          const found = result.lines[index];
          const overlap = found === null || found === undefined ? 0 : iou(box, found.bbox);
          pageTotal += 1;
          sum += overlap;
          if (overlap >= MIN_IOU) pageHits += 1;
        });
        hits += pageHits;
        total += pageTotal;
        rows.push(`${name}: ${pageHits}/${pageTotal}, skew ${result.skewDegrees.toFixed(1)}°`);
      }
      const count = Object.keys(pages).length;
      process.stdout.write(
        `\n${rows.join('\n')}\nTreffer ${hits}/${total} (${((100 * hits) / total).toFixed(1)} %), mittlere IoU ${(sum / total).toFixed(3)}, ${(elapsed / count).toFixed(0)} ms je Seite\n`,
      );
      expect(hits / total).toBeGreaterThan(0.95);
    });

    it('prefers null over a confident wrong box when the transcript differs from the page', () => {
      const perVariant = new Map<string, VariantScore[]>();
      for (const [name, lines] of Object.entries(pages)) {
        const truthLines = lines.map((line) => ({ text: line.text, bbox: boxOf(line.bbox) }));
        for (const variant of variantsOf(truthLines)) {
          const image = readJpeg(join(RENDERED, `${name}.jpg`));
          if (variant.erased !== null) paintOver(image, variant.erased, 245);
          const found = locateLines(image, variant.transcript).lines;
          const list = perVariant.get(variant.name) ?? [];
          list.push(scoreVariant(variant, found));
          perVariant.set(variant.name, list);
        }
      }
      const rows: string[] = [];
      const all: VariantScore[] = [];
      for (const [name, list] of perVariant) {
        const sum = sumScores(list);
        all.push(sum);
        rows.push(
          `${name.padEnd(36)} richtig ${sum.correct}/${sum.expected}, null ${sum.missing}, falsch-sicher ${sum.wrong}, unerwartet ${sum.spurious}`,
        );
      }
      const total = sumScores(all);
      process.stdout.write(
        `\n${rows.join('\n')}\nGesamt: richtig ${total.correct}/${total.expected}, null ${total.missing}, falsch-sicher ${total.wrong}\n`,
      );
      expect(total.wrong / total.expected).toBeLessThan(0.005);
      expect(total.spurious / total.expected).toBeLessThan(0.005);
    }, 120_000);
  },
);

const sidecar = new RealSidecar();
afterAll(() => {
  sidecar.stop();
});

const datasetAvailable =
  ENABLED &&
  existsSync(join(DATASET, 'images')) &&
  existsSync(join(MODELS_DIR, model.files.model.name));

describe.skipIf(!datasetAvailable)('real transcripts of handwritten dataset pages', () => {
  it(
    'assigns almost every transcript line a box',
    async () => {
      await sidecar.startModel();
      const rows: string[] = [];
      let lines = 0;
      let assigned = 0;
      let matching = 0;
      for (let index = 0; index < PAGES; index += 1) {
        const name = `${String(index).padStart(3, '0')}.jpg`;
        const bytes = readFileSync(join(DATASET, 'images', name));
        const dataUrl = `data:image/jpeg;base64,${bytes.toString('base64')}`;
        const transcriber = createLlmTranscriber({
          client: sidecar,
          model,
          encode: () => Promise.resolve(dataUrl),
        });
        const transcript = await transcriber.transcribe(
          new Blob([bytes]),
          new AbortController().signal,
        );
        if (!transcript.ok) throw new Error(`${name}: ${JSON.stringify(transcript.error)}`);
        const started = performance.now();
        const result = locateLines(readJpeg(join(DATASET, 'images', name)), transcript.lines);
        const milliseconds = performance.now() - started;
        const written = transcript.lines.filter((line) => line.trim() !== '').length;
        const found = result.lines.filter((line) => line !== null).length;
        lines += written;
        assigned += found;
        if (result.detectedLines === written) matching += 1;
        rows.push(
          `${name}: ${written} Zeilen transkribiert, ${result.detectedLines} erkannt, ${found} zugeordnet, ${milliseconds.toFixed(0)} ms`,
        );
      }
      process.stdout.write(
        `\n${rows.join('\n')}\nZugeordnet ${assigned}/${lines} (${((100 * assigned) / lines).toFixed(1)} %), Zeilenzahl gleich auf ${matching}/${PAGES} Seiten\n`,
      );
      expect(assigned / lines).toBeGreaterThan(0.88);
    },
    30 * 60 * 1000,
  );
});
