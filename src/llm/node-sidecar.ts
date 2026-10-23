import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, totalmem } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { ALL_MODELS, draftFile, type AnyModelInfo } from '../models/registry.ts';
import { LlmCallError, type Completion } from './client.ts';
import type { EngineClient } from './engine.ts';
import type { ChatRequest, ChatResponse, RuntimeStatus } from './types.ts';

export const CACHE = join(homedir(), '.cache', 'rotstift');
export const MODELS_DIR = process.env['ROTSTIFT_MODELS_DIR'] ?? join(CACHE, 'models');
const BINARIES = join(import.meta.dirname, '..', '..', 'src-tauri', 'binaries');
const LIBRARY_VAR = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
export const GIB = 1024 ** 3;
export const NO_REPACK =
  process.env['ROTSTIFT_NO_REPACK'] === undefined
    ? totalmem() < 12 * GIB
    : process.env['ROTSTIFT_NO_REPACK'] === '1';
const ACCEPTANCE = /draft acceptance = [\d.]+ \(\s*(\d+) accepted \/\s*(\d+) generated\)/u;

export function usableDraft(model: AnyModelInfo): string | null {
  const draft = draftFile(model);
  if (draft === null) return null;
  const path = join(MODELS_DIR, draft.name);
  return existsSync(path) ? path : null;
}

function sidecarPath(): string {
  const stamp: { target: string } = JSON.parse(
    readFileSync(join(BINARIES, 'runtime.json'), 'utf8'),
  );
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return join(BINARIES, `rotstift-llama-server-${stamp.target}${suffix}`);
}

function serverArguments(model: AnyModelInfo, speculate: boolean): string[] {
  const { server, request } = model;
  const args = [['--model', join(MODELS_DIR, model.files.model.name)]];
  if (model.role === 'transcriber') {
    args.push(['--mmproj', join(MODELS_DIR, model.files.mmproj.name)]);
    if (model.server.imageMaxTokens !== null) {
      args.push(['--image-max-tokens', String(model.server.imageMaxTokens)]);
    }
  }
  const draft = speculate ? usableDraft(model) : null;
  if (draft !== null) args.push(['--spec-type', 'draft-mtp'], ['--model-draft', draft]);
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
  const threads: string | number | null = process.env['ROTSTIFT_THREADS'] ?? server.threads;
  if (threads !== null) args.push(['--threads', String(threads)]);
  const gpuLayers: string | number | null = process.env['ROTSTIFT_GPU_LAYERS'] ?? server.gpuLayers;
  if (gpuLayers !== null) args.push(['--n-gpu-layers', String(gpuLayers)]);
  if (!server.cpuRepack && NO_REPACK) args.push(['--no-repack']);
  if (server.reasoning === 'off') args.push(['--reasoning', 'off']);
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

export class NodeSidecar implements EngineClient {
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
  readonly drafts = { accepted: 0, generated: 0 };

  private readonly speculate: boolean;

  constructor(speculate = process.env['ROTSTIFT_MTP'] !== '0') {
    this.speculate = speculate;
  }

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
    const child = spawn(sidecarPath(), serverArguments(model, this.speculate), {
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
      let partial = '';
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        log += text;
        const lines = (partial + text).split('\n');
        partial = lines.pop() ?? '';
        for (const line of lines) {
          const counts = ACCEPTANCE.exec(line);
          if (counts?.[1] === undefined || counts[2] === undefined) continue;
          this.drafts.accepted += Number(counts[1]);
          this.drafts.generated += Number(counts[2]);
        }
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
    const body: ChatResponse = await response.json();
    const choice = body.choices[0];
    const logprobs = choice?.logprobs?.content;
    return {
      text: choice?.message.content ?? '',
      finishReason: choice?.finish_reason ?? null,
      ...(Array.isArray(logprobs) && { logprobs }),
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
