import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { LlmCallError, type Completion } from '../llm/client.ts';
import type { ChatRequest, RuntimeStatus } from '../llm/types.ts';
import { recommendModel } from '../models/registry.ts';
import { countWords } from '../stats/count-words.ts';
import { createLlmTranscriber, type EngineClient } from './llm-transcriber.ts';

const ENABLED = process.env['ROTSTIFT_INTEGRATION'] === '1';
const CACHE = join(homedir(), '.cache', 'rotstift');
const DATASET =
  process.env['ROTSTIFT_DATASET'] ?? join(CACHE, 'datasets', 'scads-fullpage', 'extracted');
const MODELS_DIR = process.env['ROTSTIFT_MODELS_DIR'] ?? join(CACHE, 'models');
const PAGES = Number(process.env['ROTSTIFT_PAGES'] ?? '3');
const BINARIES = join(import.meta.dirname, '..', '..', 'src-tauri', 'binaries');
const LIBRARY_VAR = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
const model = recommendModel(null);

function sidecarPath(): string {
  const stamp: { target: string } = JSON.parse(
    readFileSync(join(BINARIES, 'runtime.json'), 'utf8'),
  );
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return join(BINARIES, `rotstift-llama-server-${stamp.target}${suffix}`);
}

function serverArguments(): string[] {
  const { server, request } = model;
  const args = [
    ['--model', join(MODELS_DIR, model.files.model.name)],
    ['--mmproj', join(MODELS_DIR, model.files.mmproj.name)],
    ['--host', '127.0.0.1'],
    ['--port', '0'],
    ['--ctx-size', String(server.contextSize)],
    ['--n-predict', String(request.maxOutputTokens)],
    ['--parallel', '1'],
    ['--cache-ram', '0'],
    ['--no-webui'],
    ['--no-slots'],
    ['--offline'],
  ];
  const gpuLayers: string | number | null = process.env['ROTSTIFT_GPU_LAYERS'] ?? server.gpuLayers;
  if (server.imageMaxTokens !== null)
    args.push(['--image-max-tokens', String(server.imageMaxTokens)]);
  if (server.threads !== null) args.push(['--threads', String(server.threads)]);
  if (gpuLayers !== null) args.push(['--n-gpu-layers', String(gpuLayers)]);
  return args.flat();
}

class RealSidecar implements EngineClient {
  private child: ChildProcess | null = null;
  private port = 0;
  private readonly key = randomBytes(16).toString('hex');
  startupSeconds = 0;

  status = (): Promise<RuntimeStatus> =>
    Promise.resolve(
      this.child === null
        ? { state: 'stopped' }
        : { state: 'ready', model: model.files.model.name, port: this.port },
    );

  startModel = async (): Promise<RuntimeStatus> => {
    const started = performance.now();
    const child = spawn(sidecarPath(), serverArguments(), {
      cwd: BINARIES + '/llama',
      env: { ...process.env, [LIBRARY_VAR]: join(BINARIES, 'llama'), LLAMA_API_KEY: this.key },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.child = child;
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
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.startupSeconds = (performance.now() - started) / 1000;
    return { state: 'ready', model: model.files.model.name, port: this.port };
  };

  complete = async (
    request: ChatRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<Completion> => {
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

  stop() {
    this.child?.kill('SIGTERM');
  }
}

const available =
  ENABLED &&
  existsSync(join(DATASET, 'images')) &&
  existsSync(join(MODELS_DIR, model.files.model.name));
const sidecar = new RealSidecar();

afterAll(() => {
  sidecar.stop();
});

describe.skipIf(!available)('real sidecar on handwritten pages', () => {
  it(
    'counts words close to the ground truth',
    async () => {
      const names = Array.from(
        { length: PAGES },
        (_, index) => `${String(index).padStart(3, '0')}.jpg`,
      );
      expect(names.length).toBeGreaterThan(0);
      await sidecar.startModel();

      const rows: string[] = [];
      for (const name of names) {
        const image = readFileSync(join(DATASET, 'images', name));
        const dataUrl = `data:image/jpeg;base64,${image.toString('base64')}`;
        const page = createLlmTranscriber({
          client: sidecar,
          model,
          encode: () => Promise.resolve(dataUrl),
        });
        const started = performance.now();
        const result = await page.transcribe(new Blob([image]), new AbortController().signal);
        const seconds = (performance.now() - started) / 1000;
        if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.error)}`);
        const truth = countWords(
          readFileSync(join(DATASET, 'ground_truth', name.replace(/\.jpg$/u, '.txt')), 'utf8'),
        );
        const counted = countWords(result.lines.join('\n'));
        rows.push(
          `${name}: ${counted} Wörter erkannt, ${truth} laut Ground Truth (${(((counted - truth) / truth) * 100).toFixed(1)} %), ${seconds.toFixed(1)} s`,
        );
        expect(Math.abs(counted - truth) / truth).toBeLessThan(0.5);
      }
      process.stdout.write(`\nStart: ${sidecar.startupSeconds.toFixed(1)} s\n${rows.join('\n')}\n`);
    },
    30 * 60 * 1000,
  );
});
