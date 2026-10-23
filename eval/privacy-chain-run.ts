import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, hostname } from 'node:os';
import { dirname } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { CONDITIONS, isCondition, loadInputs } from './privacy-inputs.ts';
import { E2B, E4B, runChain } from './privacy-chain.ts';
import type { PrivacyRun, RunItem } from './privacy-run.ts';
import { corrector, localFile } from './ocr-registry.ts';
import { launchServer, postJson, readCompletion } from './server.ts';
import type { Server } from './server.ts';

function outFile(prefix: string, model: string): string {
  return `${prefix}-${model === E4B ? 'e4b' : 'e2b'}.json`;
}

async function save(file: string, run: PrivacyRun) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(run)}\n`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      models: { type: 'string', default: `${E2B},${E4B}` },
      set: { type: 'string', default: 'holdout' },
      conditions: { type: 'string', default: 'clean,ocr,noise1' },
      threads: { type: 'string', default: '4' },
      out: { type: 'string' },
    },
  });
  if (!values.out) throw new Error('--out angeben (Präfix, etwa runs/chain-holdout)');
  const prefix = values.out;
  const models = values.models.split(',').filter(Boolean);
  const threads = Number(values.threads);
  const inputs = loadInputs(
    values.set,
    values.conditions
      .split(',')
      .filter(isCondition)
      .filter((c) => CONDITIONS.includes(c)),
  );
  const runs = new Map<string, PrivacyRun>(
    models.map((model) => {
      const file = outFile(prefix, model);
      const previous: PrivacyRun | undefined = existsSync(file)
        ? JSON.parse(readFileSync(file, 'utf8'))
        : undefined;
      return [
        model,
        previous ?? {
          detector: `${model}:app`,
          machine: `${hostname()} (${cpus()[0]?.model.trim() ?? 'CPU'})`,
          threads,
          peakRssBytes: 0,
          items: [],
        },
      ];
    }),
  );
  const servers = new Map<string, Server>();
  for (const model of models) {
    const info = corrector(model);
    const draft = info.files.draft;
    servers.set(
      model,
      await launchServer({
        model: localFile(info.files.model),
        contextSize: info.server.contextSize,
        threads,
        extraArgs: [
          '--no-repack',
          '--reasoning',
          'off',
          ...(draft ? ['--spec-type', 'draft-mtp', '--model-draft', localFile(draft)] : []),
        ],
      }),
    );
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void Promise.all([...servers.values()].map((server) => server.stop())).then(() =>
        process.exit(1),
      );
    });
  }
  try {
    for (const server of servers.values()) await server.ready(300_000);
    for (const input of inputs) {
      const done = (model: string) =>
        runs
          .get(model)
          ?.items.some((item) => item.id === input.id && item.condition === input.condition) ===
        true;
      if (models.every(done)) continue;
      const items = new Map<string, RunItem>(
        models.map((model) => [
          model,
          {
            id: input.id,
            condition: input.condition,
            spans: [],
            seconds: 0,
            promptTokens: 0,
            generatedTokens: 0,
            raw: [],
          },
        ]),
      );
      let loaded: string | null = null;
      await runChain(input, {
        models,
        isWord: () => true,
        loaded: () => loaded,
        ask: async (model, request) => {
          const server = servers.get(model);
          const item = items.get(model);
          if (!server || !item) throw new Error(`Kein Server für ${model}`);
          const started = performance.now();
          const response = await postJson(server.port, '/v1/chat/completions', request);
          if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
          const completion = readCompletion(JSON.parse(response.body));
          item.seconds += (performance.now() - started) / 1000;
          item.promptTokens += completion.promptTokens;
          item.generatedTokens += completion.generatedTokens;
          item.raw?.push(completion.content);
          loaded = model;
          return completion.content;
        },
      });
      for (const [model, item] of items) {
        const run = runs.get(model);
        if (!run) continue;
        run.items.push(item);
        await save(outFile(prefix, model), run);
      }
      console.log(
        `${input.id} ${input.condition} ${[...items].map(([model, item]) => `${model} ${item.seconds.toFixed(1)} s`).join(', ')}`,
      );
    }
  } finally {
    for (const [model, server] of servers) {
      const run = runs.get(model);
      if (!run) continue;
      run.peakRssBytes = Math.max(run.peakRssBytes, await server.stop());
      await save(outFile(prefix, model), run);
    }
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
