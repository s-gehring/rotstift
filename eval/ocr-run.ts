import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, hostname } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { visionMessage } from '../src/llm/client.ts';
import type { TokenProbability } from '../src/correction/reading-confidence.ts';
import { localFile, transcriber } from './ocr-registry.ts';
import { launchServer, postJson, record } from './server.ts';

export interface OcrPage {
  name: string;
  content: string;
  finishReason: string | null;
  seconds: number;
  promptTokens: number;
  generatedTokens: number;
  tokens: TokenProbability[];
}

export interface OcrRun {
  model: string;
  machine: string;
  threads: number;
  imageMaxEdge: number;
  peakRssBytes: number;
  pages: OcrPage[];
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function readTokens(logprobs: unknown): TokenProbability[] {
  const content = record(logprobs)['content'];
  if (!Array.isArray(content)) return [];
  return content.map((entry) => {
    const token = record(entry);
    const bytes = Array.isArray(token['bytes']) ? token['bytes'].map(Number) : [];
    return { bytes, logprob: Number(token['logprob'] ?? 0) };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: 'string', default: 'glm-ocr-q8' },
      images: { type: 'string' },
      pages: { type: 'string' },
      threads: { type: 'string', default: '8' },
      out: { type: 'string' },
      'max-edge': { type: 'string' },
    },
  });
  if (!values.images || !values.out) throw new Error('--images und --out angeben');
  const model = transcriber(values.model);
  const maxEdge = values['max-edge'] ? Number(values['max-edge']) : model.request.imageMaxEdge;
  const threads = Number(values.threads);
  const wanted = values.pages?.split(',');
  const names = readdirSync(values.images)
    .filter((name) => ['.jpg', '.jpeg'].includes(extname(name).toLowerCase()))
    .filter((name) => !wanted || wanted.includes(basename(name, extname(name))))
    .toSorted();
  const previous: OcrRun | undefined = existsSync(values.out)
    ? JSON.parse(await readFile(values.out, 'utf8'))
    : undefined;
  const pages = previous?.pages ?? [];
  const todo = names.filter(
    (name) => !pages.some((page) => page.name === basename(name, extname(name))),
  );

  const server = await launchServer({
    model: localFile(model.files.model.url),
    mmproj: localFile(model.files.mmproj.url),
    contextSize: model.server.contextSize,
    threads,
    imageMaxTokens: model.server.imageMaxTokens ?? undefined,
    extraArgs: model.server.cpuRepack ? [] : ['--no-repack'],
  });
  let peak = previous?.peakRssBytes ?? 0;
  try {
    await server.ready(300_000);
    for (const name of todo) {
      const image = (await readFile(join(values.images, name))).toString('base64');
      const started = performance.now();
      const response = await postJson(server.port, '/v1/chat/completions', {
        messages: [visionMessage(model.prompt, [`data:image/jpeg;base64,${image}`])],
        temperature: model.request.temperature,
        max_tokens: model.request.maxOutputTokens,
        logprobs: true,
      });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
      const json = record(JSON.parse(response.body));
      const choice = record(Array.isArray(json['choices']) ? json['choices'][0] : undefined);
      const timings = record(json['timings']);
      pages.push({
        name: basename(name, extname(name)),
        content: text(record(choice['message'])['content']),
        finishReason: typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null,
        seconds: (performance.now() - started) / 1000,
        promptTokens: Number(timings['prompt_n'] ?? 0),
        generatedTokens: Number(timings['predicted_n'] ?? 0),
        tokens: readTokens(choice['logprobs']),
      });
      console.log(`${model.id} ${name} ${pages.at(-1)?.seconds.toFixed(1)} s`);
      await save(values.out, {
        model: model.id,
        peak,
        threads,
        maxEdge,
        pages,
      });
    }
  } finally {
    peak = Math.max(peak, await server.stop());
  }
  await save(values.out, {
    model: model.id,
    peak,
    threads,
    maxEdge,
    pages,
  });
}

async function save(
  file: string,
  run: { model: string; peak: number; threads: number; maxEdge: number; pages: OcrPage[] },
) {
  const result: OcrRun = {
    model: run.model,
    machine: `${hostname()} (${cpus()[0]?.model.trim() ?? 'CPU'})`,
    threads: run.threads,
    imageMaxEdge: run.maxEdge,
    peakRssBytes: run.peak,
    pages: run.pages.toSorted((a, b) => a.name.localeCompare(b.name)),
  };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(result)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
