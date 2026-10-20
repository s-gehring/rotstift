import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEUTSCH } from '../src/annotations/profile.ts';
import { correctPage } from '../src/correction/correct-page.ts';
import { createLlmCorrector } from '../src/correction/llm-corrector.ts';
import type { LlmClient } from '../src/llm/client.ts';
import { correctorConfig } from '../src/llm/sidecar-corrector.ts';
import { splitTranscript } from '../src/pipeline/transcript-lines.ts';
import { installDom } from './dom.ts';
import { goldFromMarkup } from './gold.ts';
import { addNoise, learnNoise } from './ocr-noise.ts';
import { OCR_PROMPTS, promptConfig } from './ocr-prompts.ts';
import type { OcrPrompt } from './ocr-prompts.ts';
import { corrector, localFile } from './ocr-registry.ts';
import type { OcrRun } from './ocr-run.ts';
import { samplesDir } from './paths.ts';
import { launchServer, postJson, record } from './server.ts';

export interface CorrectDoc {
  id: string;
  lines: string[];
}

export interface CorrectedDoc extends CorrectDoc {
  ok: boolean;
  correctedText: string;
  error?: string;
  seconds: number;
  requests: number;
  generatedTokens: number;
  reasoningChars: number;
}

export interface CorrectRun {
  model: string;
  prompt: OcrPrompt;
  thinking: boolean;
  machine: string;
  threads: number;
  peakRssBytes: number;
  docs: CorrectedDoc[];
}

const stringOf = (value: unknown) => (typeof value === 'string' ? value : '');

export function truthLines(dataset: string, name: string): string[] {
  return splitTranscript(readFileSync(join(dataset, 'ground_truth', `${name}.txt`), 'utf8'));
}

export function textLines(text: string, clean: boolean): string[] {
  const markup = readFileSync(join(samplesDir, 'texts', `${text}.txt`), 'utf8').trim();
  const gold = goldFromMarkup(markup);
  return clean ? gold.corrected.split('\n') : gold.input.lines.map((line) => line.text);
}

export const TEXTS = ['brief', 'ferien', 'handy', 'inhaltsangabe'];

export function noiseFrom(ocrFile: string, dataset: string) {
  const run: OcrRun = JSON.parse(readFileSync(ocrFile, 'utf8'));
  return learnNoise(
    run.pages.map((page) => ({
      truth: truthLines(dataset, page.name).join(' '),
      read: splitTranscript(page.content).join(' '),
    })),
  );
}

function collectDocs(values: Record<string, string | boolean | undefined>): CorrectDoc[] {
  const docs: CorrectDoc[] = [];
  const string = (key: string) => (typeof values[key] === 'string' ? values[key] : undefined);
  const ocr = string('ocr');
  if (ocr) {
    const run: OcrRun = JSON.parse(readFileSync(ocr, 'utf8'));
    for (const page of run.pages) {
      if (page.finishReason === 'stop') {
        docs.push({ id: page.name, lines: splitTranscript(page.content) });
      }
    }
  }
  const truth = string('truth');
  for (const name of truth ? (string('pages') ?? '').split(',').filter(Boolean) : []) {
    docs.push({ id: name, lines: truthLines(truth ?? '', name) });
  }
  const texts = string('texts');
  if (texts) {
    const noiseSource = string('noise-from');
    const model = noiseSource ? noiseFrom(noiseSource, string('dataset') ?? '') : undefined;
    const seeds = (string('seeds') ?? '0').split(',').map(Number);
    for (const kind of texts.split(',')) {
      for (const text of TEXTS) {
        const lines = textLines(text, kind === 'fehlerfrei');
        if (!model) {
          docs.push({ id: `${text}--${kind}`, lines });
          continue;
        }
        for (const seed of seeds) {
          docs.push({ id: `${text}--${kind}--s${seed}`, lines: addNoise(lines, model, seed) });
        }
      }
    }
  }
  return docs;
}

async function main() {
  installDom();
  const { values } = parseArgs({
    options: {
      model: { type: 'string', default: 'gemma-4-e2b-q4' },
      prompt: { type: 'string', default: 'app' },
      ocr: { type: 'string' },
      truth: { type: 'string' },
      pages: { type: 'string' },
      texts: { type: 'string' },
      'noise-from': { type: 'string' },
      dataset: { type: 'string' },
      seeds: { type: 'string' },
      threads: { type: 'string', default: '8' },
      'no-thinking': { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  const prompt = OCR_PROMPTS.find((variant) => variant === values.prompt);
  if (!prompt || !values.out)
    throw new Error(`--prompt (${OCR_PROMPTS.join(', ')}) und --out angeben`);
  const model = corrector(values.model);
  const threads = Number(values.threads);
  const previous: CorrectRun | undefined = existsSync(values.out)
    ? JSON.parse(await readFile(values.out, 'utf8'))
    : undefined;
  const done = previous?.docs ?? [];
  const todo = collectDocs(values).filter((doc) => !done.some((entry) => entry.id === doc.id));

  const server = await launchServer({
    model: localFile(model.files.model.url),
    contextSize: model.server.contextSize,
    threads,
    extraArgs: model.server.cpuRepack ? [] : ['--no-repack'],
  });
  let peak = previous?.peakRssBytes ?? 0;
  const save = async () => {
    const run: CorrectRun = {
      model: model.id,
      prompt,
      thinking: !values['no-thinking'],
      machine: `${hostname()} (${cpus()[0]?.model.trim() ?? 'CPU'})`,
      threads,
      peakRssBytes: peak,
      docs: done.toSorted((a, b) => a.id.localeCompare(b.id)),
    };
    await mkdir(dirname(values.out ?? ''), { recursive: true });
    await writeFile(values.out ?? '', `${JSON.stringify(run)}\n`);
  };
  try {
    await server.ready(300_000);
    for (const doc of todo) {
      let requests = 0;
      let generatedTokens = 0;
      let reasoningChars = 0;
      const client: Pick<LlmClient, 'complete'> = {
        async complete(request) {
          requests += 1;
          const response = await postJson(server.port, '/v1/chat/completions', {
            ...request,
            ...(values['no-thinking'] && { chat_template_kwargs: { enable_thinking: false } }),
          });
          if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
          const json = record(JSON.parse(response.body));
          const choice = record(Array.isArray(json['choices']) ? json['choices'][0] : undefined);
          generatedTokens += Number(record(json['timings'])['predicted_n'] ?? 0);
          reasoningChars += stringOf(record(choice['message'])['reasoning_content']).length;
          return {
            text: stringOf(record(choice['message'])['content']),
            finishReason:
              typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null,
          };
        },
      };
      const started = performance.now();
      const result = await correctPage({
        lines: doc.lines,
        profile: DEUTSCH,
        corrector: createLlmCorrector({
          client,
          config: promptConfig(correctorConfig(model), prompt),
        }),
      });
      const seconds = (performance.now() - started) / 1000;
      done.push({
        ...doc,
        ok: result.ok,
        correctedText: result.ok ? result.correctedText : '',
        ...(result.ok ? {} : { error: JSON.stringify(result.error) }),
        seconds,
        requests,
        generatedTokens,
        reasoningChars,
      });
      console.log(`${prompt} ${doc.id} ${seconds.toFixed(1)} s ${result.ok ? 'ok' : 'fehler'}`);
      await save();
    }
  } finally {
    peak = Math.max(peak, await server.stop());
  }
  await save();
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
