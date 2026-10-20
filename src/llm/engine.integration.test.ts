import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { defaultCorrector, recommendModel } from '../models/registry.ts';
import { createLlmTranscriber } from '../pipeline/llm-transcriber.ts';
import { createLlmEngine } from './engine.ts';
import { CACHE, GIB, MODELS_DIR, NO_REPACK, NodeSidecar } from './node-sidecar.ts';
import { createSidecarCorrector } from './sidecar-corrector.ts';

const ENABLED = process.env['ROTSTIFT_INTEGRATION'] === '1';
const FONT = process.env['ROTSTIFT_FONT'] ?? join(CACHE, 'fonts', 'Caveat[wght].ttf');

const transcriber = recommendModel();
const corrector = defaultCorrector();

const PAGE = [
  'Am Samstag waren wir im Zoo.',
  'Die Affen haben Bananen gegessen.',
  'Danach sind wir nach Hause gefahren.',
];

const ESSAY = [
  'Letzten sommer bin ich mit meiner Familie ans Meer gefahren.',
  'Wir haben jeden Tag im Wasser gebadet und eine grosse Sandburg gebaut.',
  'Am Abend haben wir Eis gegessen, das hat sehr lecker geschmeckt.',
  'Ich freue mich schon auf die nächsten ferien.',
];

async function renderPage(lines: readonly string[]): Promise<string> {
  const { GlobalFonts, createCanvas } = await import('@napi-rs/canvas');
  GlobalFonts.registerFromPath(FONT, 'Handschrift');
  const canvas = createCanvas(1240, 160 + lines.length * 110);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#1a1a40';
  context.font = '64px Handschrift';
  lines.forEach((line, index) => {
    context.fillText(line, 90, 140 + index * 110);
  });
  return `data:image/png;base64,${(await canvas.encode('png')).toString('base64')}`;
}

const available =
  ENABLED &&
  existsSync(FONT) &&
  [transcriber.files.model, transcriber.files.mmproj, corrector.files.model].every((file) =>
    existsSync(join(MODELS_DIR, file.name)),
  );
const sidecar = new NodeSidecar();

afterAll(async () => {
  await sidecar.stop();
});

const signal = () => new AbortController().signal;
const seconds = (since: number) => ((performance.now() - since) / 1000).toFixed(1);
const gigabytes = (bytes: number | undefined) => ((bytes ?? 0) / GIB).toFixed(2);

describe.skipIf(!available)('real sidecar switching between transcriber and corrector', () => {
  it(
    'transcribes a page, corrects a text with Gemma and transcribes again',
    async () => {
      const dataUrl = await renderPage(PAGE);
      const engine = createLlmEngine(sidecar);
      const pages = createLlmTranscriber({
        client: sidecar,
        engine,
        model: transcriber,
        encode: () => Promise.resolve(dataUrl),
      });
      const correction = createSidecarCorrector(corrector, { engine, client: sidecar });
      const png = new Blob(['page']);
      const report: string[] = [];

      let started = performance.now();
      const first = await pages.transcribe(png, signal());
      if (!first.ok) throw new Error(JSON.stringify(first.error));
      report.push(`Seite 1 mit ${transcriber.id}: ${seconds(started)} s`);
      expect(first.lines.join(' ')).toContain('Affen');

      started = performance.now();
      const corrected = await correction.correct(ESSAY, DEUTSCH, signal());
      if (!corrected.ok) throw new Error(JSON.stringify(corrected.error));
      report.push(`Wechsel und Korrektur mit ${corrector.id}: ${seconds(started)} s`);
      const fixes = ['Sommer', 'große', 'Ferien'].filter((word) =>
        corrected.correctedText.includes(word),
      );
      report.push(`Korrigiert: ${fixes.join(', ')} von Sommer, große, Ferien`);
      expect(fixes.length).toBeGreaterThanOrEqual(2);
      expect(corrected.correctedText.split('\n')).toHaveLength(ESSAY.length);
      expect(corrected.correctedText).toContain(
        'Am Abend haben wir Eis gegessen, das hat sehr lecker geschmeckt.',
      );

      started = performance.now();
      const second = await pages.transcribe(png, signal());
      if (!second.ok) throw new Error(JSON.stringify(second.error));
      report.push(`Zurück und Seite 2 mit ${transcriber.id}: ${seconds(started)} s`);
      expect(second.lines).toEqual(first.lines);

      expect(sidecar.events).toEqual([
        `start ${transcriber.id}`,
        `complete ${transcriber.id}`,
        'stop',
        `start ${corrector.id}`,
        `complete ${corrector.id}`,
        'stop',
        `start ${transcriber.id}`,
        `complete ${transcriber.id}`,
      ]);
      expect(sidecar.maxLive).toBe(1);

      for (const model of [transcriber, corrector]) {
        const starts = (sidecar.startSeconds.get(model.id) ?? []).map((value) => value.toFixed(1));
        report.push(
          `${model.id}: Start ${starts.join(' / ')} s, Peak-RSS ${gigabytes(sidecar.peakBytes.get(model.id))} GB`,
        );
      }
      report.push(`--no-repack für den Korrektor: ${NO_REPACK ? 'ja' : 'nein'}`);
      process.stdout.write(`\n${report.join('\n')}\n`);
    },
    30 * 60 * 1000,
  );
});
