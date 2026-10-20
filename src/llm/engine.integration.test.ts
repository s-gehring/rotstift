import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, totalmem } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import {
  ALL_MODELS,
  defaultCorrector,
  recommendModel,
  type AnyModelInfo,
} from '../models/registry.ts';
import { createLlmTranscriber } from '../pipeline/llm-transcriber.ts';
import { LlmCallError, type Completion } from './client.ts';
import { createLlmEngine, type EngineClient } from './engine.ts';
import { createSidecarCorrector } from './sidecar-corrector.ts';
import type { ChatRequest, RuntimeStatus } from './types.ts';

const ENABLED = process.env['ROTSTIFT_INTEGRATION'] === '1';
const CACHE = join(homedir(), '.cache', 'rotstift');
const MODELS_DIR = process.env['ROTSTIFT_MODELS_DIR'] ?? join(CACHE, 'models');
const FONT = process.env['ROTSTIFT_FONT'] ?? join(CACHE, 'fonts', 'Caveat[wght].ttf');
const BINARIES = join(import.meta.dirname, '..', '..', 'src-tauri', 'binaries');
const LIBRARY_VAR = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
const GIB = 1024 ** 3;
const NO_REPACK =
  process.env['ROTSTIFT_NO_REPACK'] === undefined
    ? totalmem() < 12 * GIB
    : process.env['ROTSTIFT_NO_REPACK'] === '1';

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

function sidecarPath(): string {
  const stamp: { target: string } = JSON.parse(
    readFileSync(join(BINARIES, 'runtime.json'), 'utf8'),
  );
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return join(BINARIES, `rotstift-llama-server-${stamp.target}${suffix}`);
}

function serverArguments(model: AnyModelInfo): string[] {
  const { server, request } = model;
  const args = [['--model', join(MODELS_DIR, model.files.model.name)]];
  if (model.role === 'transcriber') {
    args.push(['--mmproj', join(MODELS_DIR, model.files.mmproj.name)]);
    if (model.server.imageMaxTokens !== null) {
      args.push(['--image-max-tokens', String(model.server.imageMaxTokens)]);
    }
  }
  args.push(
    ['--host', '127.0.0.1'],
    ['--port', '0'],
    ['--ctx-size', String(server.contextSize)],
    ['--n-predict', String(request.maxOutputTokens)],
    ['--parallel', '1'],
    ['--cache-ram', '0'],
    ['--no-webui'],
    ['--no-slots'],
    ['--offline'],
  );
  if (server.threads !== null) args.push(['--threads', String(server.threads)]);
  const gpuLayers: string | number | null = process.env['ROTSTIFT_GPU_LAYERS'] ?? server.gpuLayers;
  if (gpuLayers !== null) args.push(['--n-gpu-layers', String(gpuLayers)]);
  if (!server.cpuRepack && NO_REPACK) args.push(['--no-repack']);
  return args.flat();
}

function residentBytes(pid: number): number {
  try {
    return (
      Number(
        execFileSync('ps', ['-o', 'rss=', '-p', String(pid)])
          .toString()
          .trim(),
      ) * 1024
    );
  } catch {
    return 0;
  }
}

class NodeSidecar implements EngineClient {
  private child: ChildProcess | null = null;
  private model: AnyModelInfo | null = null;
  private port = 0;
  private readonly key = randomBytes(16).toString('hex');
  private sampler: ReturnType<typeof setInterval> | null = null;
  live = 0;
  maxLive = 0;
  readonly events: string[] = [];
  readonly peakBytes = new Map<string, number>();
  readonly startSeconds = new Map<string, number[]>();

  status = (): Promise<RuntimeStatus> =>
    Promise.resolve(
      this.child === null || this.model === null
        ? { state: 'stopped' }
        : { state: 'ready', model: this.model.files.model.name, port: this.port },
    );

  startModel = async (modelId: string): Promise<RuntimeStatus> => {
    const model = ALL_MODELS.find((entry) => entry.id === modelId);
    if (model === undefined) throw new LlmCallError({ kind: 'invalidModelName', detail: modelId });
    if (this.child !== null) await this.stop();
    this.events.push(`start ${modelId}`);
    const started = performance.now();
    const child = spawn(sidecarPath(), serverArguments(model), {
      cwd: join(BINARIES, 'llama'),
      env: { ...process.env, [LIBRARY_VAR]: join(BINARIES, 'llama'), LLAMA_API_KEY: this.key },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.child = child;
    this.model = model;
    this.live += 1;
    this.maxLive = Math.max(this.maxLive, this.live);
    child.once('exit', () => {
      this.live -= 1;
    });
    const pid = child.pid ?? 0;
    this.sampler = setInterval(() => {
      const bytes = residentBytes(pid);
      this.peakBytes.set(modelId, Math.max(this.peakBytes.get(modelId) ?? 0, bytes));
    }, 200);
    this.port = await new Promise<number>((resolve, reject) => {
      let log = '';
      child.stderr.on('data', (chunk: Buffer) => {
        log += chunk.toString();
        const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/u.exec(log);
        if (match?.[1] !== undefined) resolve(Number(match[1]));
      });
      child.once('exit', (code) => {
        reject(
          new LlmCallError({
            kind: 'exitedDuringStartup',
            detail: { code, log: log.slice(-2000) },
          }),
        );
      });
    });
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const health = await fetch(`http://127.0.0.1:${this.port}/health`).catch(() => null);
      if (health?.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const seconds = (performance.now() - started) / 1000;
    this.startSeconds.set(modelId, [...(this.startSeconds.get(modelId) ?? []), seconds]);
    return { state: 'ready', model: model.files.model.name, port: this.port };
  };

  complete = async (
    request: ChatRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<Completion> => {
    this.events.push(`complete ${this.model?.id ?? 'none'}`);
    const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ ...request, stream: false }),
      signal: options.signal ?? null,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const body: {
      choices: { finish_reason: string | null; message: { content: string } }[];
    } = await response.json();
    return {
      text: body.choices[0]?.message.content ?? '',
      finishReason: body.choices[0]?.finish_reason ?? null,
    };
  };

  stop = async (): Promise<RuntimeStatus> => {
    const child = this.child;
    if (this.sampler !== null) clearInterval(this.sampler);
    this.sampler = null;
    this.child = null;
    this.model = null;
    if (child !== null && child.exitCode === null) {
      this.events.push('stop');
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    return { state: 'stopped' };
  };
}

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
