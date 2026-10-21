import { parseArgs } from 'node:util';
import type { AnyModelInfo } from '../src/models/registry.ts';
import { corrector, localFile, transcriber } from './ocr-registry.ts';
import { launchServer } from './server.ts';

function find(id: string): AnyModelInfo {
  try {
    return transcriber(id);
  } catch {
    return corrector(id);
  }
}

async function loadOnce(model: AnyModelInfo, threads: number) {
  const started = performance.now();
  const server = await launchServer({
    model: localFile(model.files.model),
    ...(model.role === 'transcriber' && { mmproj: localFile(model.files.mmproj) }),
    contextSize: model.server.contextSize,
    threads,
    extraArgs: [
      ...(model.server.cpuRepack ? [] : ['--no-repack']),
      ...(model.server.reasoning === 'off' ? ['--reasoning', 'off'] : []),
    ],
  });
  try {
    await server.ready(300_000);
    return { seconds: (performance.now() - started) / 1000, peakRssBytes: await server.stop() };
  } catch (error) {
    await server.stop();
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      models: { type: 'string' },
      repeats: { type: 'string', default: '3' },
      threads: { type: 'string', default: '8' },
    },
  });
  if (!values.models) throw new Error('--models a,b,c');
  const repeats = Number(values.repeats);
  console.log('| Modell | Dateien (GB) | Laden (s, Median) | RSS nach dem Laden (GB) |');
  console.log('| ------ | -----------: | ----------------: | ----------------------: |');
  for (const id of values.models.split(',')) {
    const model = find(id);
    const runs = [];
    for (let run = 0; run < repeats; run += 1)
      runs.push(await loadOnce(model, Number(values.threads)));
    const seconds = runs.map((run) => run.seconds).toSorted((a, b) => a - b);
    const bytes =
      model.files.model.bytes + (model.role === 'transcriber' ? model.files.mmproj.bytes : 0);
    const rss = Math.max(...runs.map((run) => run.peakRssBytes));
    console.log(
      `| ${model.displayName} | ${(bytes / 1e9).toFixed(2)} | ${seconds[Math.floor(seconds.length / 2)]?.toFixed(1)} | ${(rss / 1e9).toFixed(2)} |`,
    );
  }
}

await main();
