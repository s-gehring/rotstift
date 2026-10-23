import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { deriveMarks } from '../correction/derive.ts';
import { parseGold } from '../correction/gold.ts';
import { defaultCorrector, draftFile } from '../models/registry.ts';
import { createLlmEngine } from './engine.ts';
import { GIB, MODELS_DIR, NodeSidecar } from './node-sidecar.ts';
import { createSidecarCorrector } from './sidecar-corrector.ts';

const ENABLED = process.env['ROTSTIFT_INTEGRATION'] === '1';
const ROUNDS = Number(process.env['ROTSTIFT_MTP_ROUNDS'] ?? '1');
const OUT = process.env['ROTSTIFT_MTP_OUT'];
const TEXTS = join(import.meta.dirname, '..', '..', 'eval', 'samples', 'texts');

const corrector = defaultCorrector();
const head = draftFile(corrector);

const available =
  ENABLED &&
  head !== null &&
  [corrector.files.model, head].every((file) => existsSync(join(MODELS_DIR, file.name)));

interface Page {
  readonly name: string;
  readonly lines: readonly string[];
}

const split = (text: string) => text.split('\n').filter((line) => line.trim() !== '');

function samplePages(): Page[] {
  return readdirSync(TEXTS)
    .filter((name) => name.endsWith('.txt'))
    .toSorted()
    .flatMap((name) => {
      const gold = parseGold(readFileSync(join(TEXTS, name), 'utf8'));
      return [
        { name: `${name} mit Fehlern`, lines: split(gold.written) },
        { name: `${name} fehlerfrei`, lines: split(gold.corrected) },
      ];
    });
}

async function correctAll(pages: readonly Page[], speculate: boolean) {
  const sidecar = new NodeSidecar(speculate);
  const correction = createSidecarCorrector(corrector, {
    engine: createLlmEngine(sidecar),
    client: sidecar,
  });
  await sidecar.startModel(corrector.id);
  const results = [];
  for (const page of pages) {
    const started = performance.now();
    const result = await correction.correct(page.lines, DEUTSCH, new AbortController().signal);
    const seconds = (performance.now() - started) / 1000;
    if (!result.ok) throw new Error(`${page.name}: ${JSON.stringify(result.error)}`);
    const marks = deriveMarks(page.lines, result.correctedText, { profile: DEUTSCH });
    results.push({ name: page.name, seconds, text: result.correctedText, marks });
  }
  await sidecar.stop();
  const seconds = results.reduce((sum, entry) => sum + entry.seconds, 0);
  return {
    speculate,
    seconds,
    results,
    drafts: { ...sidecar.drafts },
    peakGb: (sidecar.peakBytes.get(corrector.id) ?? 0) / GIB,
  };
}

describe.skipIf(!available)('speculative decoding with the MTP head of Gemma 4 E2B', () => {
  it(
    'keeps every mark and reports time and acceptance',
    async () => {
      const pages = samplePages();
      const runs = [];
      for (let round = 0; round < ROUNDS; round += 1) {
        runs.push(await correctAll(pages, false), await correctAll(pages, true));
      }
      const report = runs.map((run) => {
        const rate = run.drafts.generated === 0 ? 0 : run.drafts.accepted / run.drafts.generated;
        return [
          run.speculate ? 'mit Kopf ' : 'ohne Kopf',
          `${(run.seconds / pages.length).toFixed(2)} s je Seite`,
          `${run.seconds.toFixed(1)} s für ${pages.length} Seiten`,
          `angenommen ${run.drafts.accepted} von ${run.drafts.generated} (${(rate * 100).toFixed(0)} %)`,
          `Peak ${run.peakGb.toFixed(2)} GiB`,
        ].join(', ');
      });
      process.stdout.write(`\n${report.join('\n')}\n`);
      if (OUT !== undefined) writeFileSync(OUT, JSON.stringify(runs, null, 2));

      const [first, ...rest] = runs;
      if (first === undefined) throw new Error('no run');
      for (const run of rest) {
        expect(run.results.map((entry) => entry.marks)).toEqual(
          first.results.map((entry) => entry.marks),
        );
      }
      for (const run of runs) {
        expect(run.drafts.generated > 0).toBe(run.speculate);
      }
    },
    60 * 60 * 1000,
  );
});
