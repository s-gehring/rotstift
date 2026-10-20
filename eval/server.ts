import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { llamaServer } from './paths.ts';

export function freePort(): Promise<number> {
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

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

const count = (value: unknown) => (typeof value === 'number' ? value : 0);

export function readCompletion(json: unknown) {
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

export function postJson(port: number, path: string, payload: unknown) {
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

export interface ServerOptions {
  model: string;
  mmproj?: string;
  contextSize: number;
  threads: number;
  imageMaxTokens?: number | undefined;
  batchSize?: number | undefined;
  ubatchSize?: number | undefined;
  extraArgs?: string[] | undefined;
}

export interface Server {
  port: number;
  log: () => string;
  ready: (timeoutMs: number) => Promise<void>;
  stop: () => Promise<number>;
}

export async function launchServer(options: ServerOptions): Promise<Server> {
  const { binary, libraryDir } = llamaServer();
  const port = await freePort();
  const libraryVariable = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  const child: ChildProcess = spawn(
    binary,
    [
      ['--model', options.model],
      options.mmproj ? ['--mmproj', options.mmproj, '--no-mmproj-offload'] : [],
      ['--host', '127.0.0.1'],
      ['--port', String(port)],
      ['--ctx-size', String(options.contextSize)],
      ['--threads', String(options.threads)],
      ['--threads-batch', String(options.threads)],
      ['--n-gpu-layers', '0'],
      ['--device', 'none'],
      ['--parallel', '1'],
      ['--cache-ram', '0'],
      ['--no-webui'],
      ['--offline'],
      options.imageMaxTokens ? ['--image-max-tokens', String(options.imageMaxTokens)] : [],
      options.batchSize ? ['--batch-size', String(options.batchSize)] : [],
      options.ubatchSize ? ['--ubatch-size', String(options.ubatchSize)] : [],
      options.extraArgs ?? [],
    ].flat(),
    {
      cwd: libraryDir,
      env: { ...process.env, [libraryVariable]: libraryDir },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  const log: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => {
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

  return {
    port,
    log: () => log.join('\n'),
    async ready(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (exited) throw new Error('llama-server exited during startup');
        const healthy = await fetch(`http://127.0.0.1:${port}/health`)
          .then((response) => response.ok)
          .catch(() => false);
        if (healthy) return;
        await sleep(250);
      }
      throw new Error('llama-server did not become healthy in time');
    },
    async stop() {
      child.kill();
      await exit;
      return stopWatching();
    },
  };
}
