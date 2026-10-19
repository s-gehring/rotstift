import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { basename, extname, join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { countWords } from '../src/stats/count-words.ts';
import { characterEdits, classifyErrors, cleanTranscript, wordEdits } from './metrics.ts';
import { CANDIDATES, PROMPTS, TRANSCRIBE_PROMPT } from './models.ts';
import type { Candidate } from './models.ts';
import { evalDir, llamaServer, modelsDir, samplesDir } from './paths.ts';
import {
  cerByFontTable,
  overviewTable,
  preservationByKindTable,
  summarize,
  wordCountByPageTable,
} from './report.ts';
import type { ModelRun, PageResult } from './report.ts';
import { parseSample } from './sample.ts';
import type { Sample } from './sample.ts';

interface Page {
  image: string;
  text: string;
  font: string;
  sample: Sample;
}

interface Options {
  threads: number;
  contextSize: number;
  maxTokens: number;
  imageMaxTokens: number | undefined;
  prompt: string;
}

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function discoverPages(filter: string[] | undefined): Page[] {
  const pages: Page[] = [];
  const renderedDir = join(samplesDir, 'rendered');
  if (existsSync(renderedDir)) {
    for (const name of readdirSync(renderedDir).toSorted()) {
      const match = /^(.+)--(.+)\.jpg$/.exec(name);
      if (!match?.[1] || !match[2]) continue;
      const markup = readFileSync(join(samplesDir, 'texts', `${match[1]}.txt`), 'utf8');
      pages.push({
        image: join(renderedDir, name),
        text: match[1],
        font: match[2],
        sample: parseSample(markup.trim()),
      });
    }
  }
  const scansDir = join(samplesDir, 'scans');
  for (const name of readdirSync(scansDir).toSorted()) {
    const extension = extname(name).toLowerCase();
    const truth = join(scansDir, `${basename(name, extname(name))}.txt`);
    if (!IMAGE_TYPES[extension] || !existsSync(truth)) continue;
    pages.push({
      image: join(scansDir, name),
      text: basename(name, extname(name)),
      font: 'scan',
      sample: parseSample(readFileSync(truth, 'utf8').trim()),
    });
  }
  return filter
    ? pages.filter((page) => filter.some((part) => basename(page.image).includes(part)))
    : pages;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function watchPeakRss(pid: number): () => number {
  let peak = 0;
  const timer = setInterval(() => {
    execFile('ps', ['-o', 'rss=', '-p', String(pid)], (error, stdout) => {
      const kilobytes = Number.parseInt(stdout.trim(), 10);
      if (!error && Number.isFinite(kilobytes)) peak = Math.max(peak, kilobytes * 1024);
    });
  }, 200);
  return () => {
    clearInterval(timer);
    return peak;
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

const count = (value: unknown) => (typeof value === 'number' ? value : 0);

function readCompletion(json: unknown) {
  const root = record(json);
  const choices = root['choices'];
  const message = record(record(Array.isArray(choices) ? choices[0] : undefined)['message']);
  const timings = record(root['timings']);
  return {
    content: typeof message['content'] === 'string' ? message['content'] : '',
    promptTokens: count(timings['prompt_n']),
    generatedTokens: count(timings['predicted_n']),
  };
}

async function waitForHealth(port: number, exited: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited()) throw new Error('llama-server exited during startup');
    const healthy = await fetch(`http://127.0.0.1:${port}/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (healthy) return;
    await sleep(250);
  }
  throw new Error('llama-server did not become healthy in time');
}

async function transcribe(port: number, candidate: Candidate, page: Page, options: Options) {
  const type = IMAGE_TYPES[extname(page.image).toLowerCase()] ?? 'image/jpeg';
  const image = (await readFile(page.image)).toString('base64');
  const content: unknown[] = [
    { type: 'image_url', image_url: { url: `data:${type};base64,${image}` } },
  ];
  const prompt = promptFor(candidate, options);
  if (prompt) content.push({ type: 'text', text: prompt });
  const started = performance.now();
  const response = await postJson(port, '/v1/chat/completions', {
    messages: [{ role: 'user', content }],
    temperature: 0,
    max_tokens: options.maxTokens,
    cache_prompt: false,
    chat_template_kwargs: { enable_thinking: false },
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
  const completion = readCompletion(JSON.parse(response.body));
  return { ...completion, seconds: (performance.now() - started) / 1000 };
}

function promptFor(candidate: Candidate, options: Options): string | null {
  return candidate.prompt === TRANSCRIBE_PROMPT
    ? (PROMPTS[options.prompt] ?? TRANSCRIBE_PROMPT)
    : candidate.prompt;
}

function postJson(port: number, path: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() });
        });
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

async function evaluate(candidate: Candidate, pages: Page[], options: Options): Promise<ModelRun> {
  const dir = modelsDir();
  const { binary, libraryDir } = llamaServer();
  const port = await freePort();
  const libraryVariable = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  const child = spawn(
    binary,
    [
      ['--model', join(dir, candidate.model.name)],
      ['--mmproj', join(dir, candidate.mmproj.name)],
      ['--host', '127.0.0.1'],
      ['--port', String(port)],
      ['--ctx-size', String(options.contextSize)],
      ['--threads', String(options.threads)],
      ['--threads-batch', String(options.threads)],
      ['--n-gpu-layers', '0'],
      ['--device', 'none'],
      ['--no-mmproj-offload'],
      ['--parallel', '1'],
      ['--cache-ram', '0'],
      ['--no-webui'],
      ['--offline'],
      options.imageMaxTokens ? ['--image-max-tokens', String(options.imageMaxTokens)] : [],
    ].flat(),
    {
      cwd: libraryDir,
      env: { ...process.env, [libraryVariable]: libraryDir },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  const log: string[] = [];
  child.stderr.on('data', (chunk: Buffer) => {
    log.push(...chunk.toString().split('\n'));
    log.splice(0, Math.max(0, log.length - 30));
  });
  let exited = false;
  const exit = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true;
      resolve();
    });
  });
  const stopWatching = watchPeakRss(child.pid ?? 0);

  const run: ModelRun = {
    id: candidate.id,
    label: candidate.label,
    license: candidate.license,
    bytes: candidate.model.bytes + candidate.mmproj.bytes,
    threads: options.threads,
    contextSize: options.contextSize,
    imageMaxTokens: options.imageMaxTokens,
    prompt: candidate.prompt === TRANSCRIBE_PROMPT ? options.prompt : 'model',
    loadSeconds: 0,
    peakRssBytes: 0,
    pages: [],
  };
  const started = performance.now();
  try {
    await waitForHealth(port, () => exited, 10 * 60_000);
    run.loadSeconds = (performance.now() - started) / 1000;
    for (const page of pages) {
      const result = await transcribe(port, candidate, page, options);
      const transcript = cleanTranscript(result.content);
      const chars = characterEdits(page.sample.written, transcript);
      const words = wordEdits(page.sample.written, transcript);
      const pageResult: PageResult = {
        image: basename(page.image),
        text: page.text,
        font: page.font,
        seconds: result.seconds,
        promptTokens: result.promptTokens,
        generatedTokens: result.generatedTokens,
        charEdits: chars.edits,
        charCount: chars.total,
        wordEdits: words.edits,
        wordCount: words.total,
        errors: classifyErrors(page.sample, transcript),
        transcript,
        expectedWords: countWords(page.sample.written),
        transcribedWords: countWords(transcript),
      };
      run.pages.push(pageResult);
      console.log(
        `  ${pageResult.image}: ${result.seconds.toFixed(1)} s, CER ${((100 * chars.edits) / Math.max(chars.total, 1)).toFixed(1)} %`,
      );
    }
  } catch (error) {
    run.failure = `${error instanceof Error ? error.message : String(error)}\n${log.join('\n')}`;
    console.error(`  ${candidate.id} failed: ${run.failure}`);
  } finally {
    child.kill();
    await exit;
    run.peakRssBytes = stopWatching();
  }
  return run;
}

function report(runs: ModelRun[], pages: Page[], options: Options): string {
  return [
    `Seiten: ${pages.length}, Threads: ${options.threads}, Kontext: ${options.contextSize}, ` +
      `Bild-Token max.: ${options.imageMaxTokens ?? 'Modellstandard'}, Prompt: ${options.prompt}, ` +
      'nur CPU (-ngl 0, --device none)',
    '',
    overviewTable(runs.map(summarize)),
    '',
    'Abweichung der Wortzahl je Seite:',
    '',
    wordCountByPageTable(runs),
    '',
    'CER je Schrift:',
    '',
    cerByFontTable(runs),
    '',
    'Erhaltene Fehler je Fehlerart:',
    '',
    preservationByKindTable(runs),
    '',
  ].join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      models: { type: 'string' },
      samples: { type: 'string' },
      threads: { type: 'string', default: '4' },
      'ctx-size': { type: 'string', default: '8192' },
      'max-tokens': { type: 'string', default: '1536' },
      'image-max-tokens': { type: 'string' },
      prompt: { type: 'string', default: 'standard' },
      out: { type: 'string' },
    },
  });
  const options: Options = {
    threads: Number(values.threads),
    contextSize: Number(values['ctx-size']),
    maxTokens: Number(values['max-tokens']),
    imageMaxTokens: values['image-max-tokens'] ? Number(values['image-max-tokens']) : undefined,
    prompt: values.prompt,
  };
  if (!PROMPTS[options.prompt]) {
    throw new Error(
      `Unknown prompt ${options.prompt}, use one of ${Object.keys(PROMPTS).join(', ')}`,
    );
  }
  const pages = discoverPages(values.samples?.split(','));
  if (pages.length === 0) throw new Error('No samples found, run eval/samples/render.py first');
  const wanted = values.models?.split(',');
  const candidates = wanted
    ? wanted.map((id) => {
        const candidate = CANDIDATES.find((entry) => entry.id === id);
        if (!candidate) throw new Error(`Unknown model ${id}`);
        return candidate;
      })
    : CANDIDATES;
  const out =
    values.out ??
    join(evalDir, 'results', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
  await mkdir(out, { recursive: true });

  const runs: ModelRun[] = [];
  for (const candidate of candidates) {
    const file = join(out, `${candidate.id}.json`);
    if (existsSync(file)) {
      const previous: ModelRun = JSON.parse(await readFile(file, 'utf8'));
      runs.push(previous);
      continue;
    }
    const missing = [candidate.model, candidate.mmproj].filter(
      (model) => !existsSync(join(modelsDir(), model.name)),
    );
    if (missing.length > 0) {
      console.log(`${candidate.label}: skipped, run eval/download-models.ts first`);
      continue;
    }
    console.log(candidate.label);
    const run = await evaluate(candidate, pages, options);
    await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
    runs.push(run);
  }

  const summary = report(runs, pages, options);
  await writeFile(join(out, 'summary.md'), summary);
  console.log(`\n${summary}\nResults: ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
