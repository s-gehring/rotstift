import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { visionMessage } from '../src/llm/client.ts';
import { RETRY_REPEAT_PENALTY } from '../src/pipeline/llm-transcriber.ts';
import { isDegenerateAnswer, parseTranscript } from '../src/pipeline/transcript-lines.ts';
import { wordEdits } from './metrics.ts';
import { serverArgs } from './ocr-run.ts';
import { localFile, transcriber } from './ocr-registry.ts';
import { launchServer, postJson, record } from './server.ts';

interface Attempt {
  content: string;
  finishReason: string | null;
  seconds: number;
  generatedTokens: number;
  degenerate: boolean;
}

interface Page {
  name: string;
  attempts: Attempt[];
}

interface Condition {
  label: string;
  attempts: number;
}

const CONDITIONS: Condition[] = [
  { label: 'erster Versuch', attempts: 1 },
  { label: 'mit zweitem Versuch', attempts: 2 },
];

async function ask(
  port: number,
  prompt: string,
  image: string,
  temperature: number,
  maxTokens: number,
  penalty?: number,
) {
  const started = performance.now();
  const response = await postJson(port, '/v1/chat/completions', {
    messages: [visionMessage(prompt, [`data:image/jpeg;base64,${image}`])],
    temperature,
    max_tokens: maxTokens,
    ...(penalty !== undefined && { repeat_penalty: penalty }),
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
  const json = record(JSON.parse(response.body));
  const choice = record(Array.isArray(json['choices']) ? json['choices'][0] : undefined);
  const content = record(choice['message'])['content'];
  const text = typeof content === 'string' ? content : '';
  const finishReason = typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null;
  const timings = record(json['timings']);
  const lines = parseTranscript(text).lines;
  return {
    content: text,
    finishReason,
    seconds: (performance.now() - started) / 1000,
    generatedTokens: Number(timings['predicted_n'] ?? 0),
    degenerate: isDegenerateAnswer(finishReason, lines),
  } satisfies Attempt;
}

function delivered(page: Page, attempts: number): string | null {
  const last = page.attempts.slice(0, attempts).at(-1);
  if (!last) return null;
  const failed = last.degenerate && page.attempts.length >= attempts && attempts > 1;
  return failed ? null : parseTranscript(last.content.replaceAll('~~', '')).lines.join('\n');
}

function truthText(truthDir: string, name: string): string | null {
  const file = join(truthDir, `${name}.txt`);
  return existsSync(file) ? readFileSync(file, 'utf8').replaceAll(/~~\S+~~/gu, '') : null;
}

function report(name: string, pages: Page[], truthDir: string) {
  const rows = CONDITIONS.map((condition) => {
    let edits = 0;
    let words = 0;
    let editsDelivered = 0;
    let wordsDelivered = 0;
    let failed = 0;
    let retried = 0;
    for (const page of pages) {
      const truth = truthText(truthDir, page.name);
      if (truth === null) continue;
      const text = delivered(page, condition.attempts);
      const count = wordEdits(truth, text ?? '');
      edits += count.edits;
      words += count.total;
      if (text === null) failed += 1;
      else {
        editsDelivered += count.edits;
        wordsDelivered += count.total;
      }
      if (page.attempts.length > 1) retried += 1;
    }
    const seconds = pages.reduce(
      (sum, page) =>
        sum + page.attempts.slice(0, condition.attempts).reduce((a, b) => a + b.seconds, 0),
      0,
    );
    return {
      condition: condition.label,
      wer: edits / Math.max(1, words),
      werDelivered: editsDelivered / Math.max(1, wordsDelivered),
      failed,
      retried: condition.attempts > 1 ? retried : 0,
      loops: pages.filter((page) => page.attempts[0]?.degenerate).length,
      seconds: Math.round(seconds),
    };
  });
  return { name, pages: pages.length, rows };
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: 'string', default: 'glm-ocr-q8' },
      set: { type: 'string', multiple: true },
      out: { type: 'string' },
      threads: { type: 'string', default: '6' },
      penalty: { type: 'string', default: String(RETRY_REPEAT_PENALTY) },
      pages: { type: 'string' },
      report: { type: 'boolean', default: false },
    },
  });
  if (!values.set?.length || !values.out) throw new Error('--set name=Bilder=Wahrheit und --out');
  const model = transcriber(values.model);
  const sets = values.set.map((entry) => {
    const [name, images, truth] = entry.split('=');
    if (!name || !images || !truth) throw new Error(`Ungültiger --set ${entry}`);
    return { name, images, truth };
  });
  const wanted = values.pages?.split(',');
  const outDir = values.out;
  const load = async (name: string): Promise<Page[]> => {
    const file = join(outDir, `${name}.json`);
    if (!existsSync(file)) return [];
    const pages: Page[] = JSON.parse(await readFile(file, 'utf8'));
    return pages;
  };
  if (!values.report) {
    const server = await launchServer({
      model: localFile(model.files.model),
      mmproj: localFile(model.files.mmproj),
      contextSize: model.server.contextSize,
      threads: Number(values.threads),
      imageMaxTokens: model.server.imageMaxTokens ?? undefined,
      extraArgs: serverArgs(model),
    });
    try {
      await server.ready(300_000);
      for (const set of sets) {
        const pages = await load(set.name);
        const names = readdirSync(set.images)
          .filter((name) => ['.jpg', '.jpeg'].includes(extname(name).toLowerCase()))
          .filter((name) => !wanted || wanted.includes(basename(name, extname(name))))
          .toSorted();
        for (const name of names) {
          const stem = basename(name, extname(name));
          if (pages.some((page) => page.name === stem)) continue;
          const image = (await readFile(join(set.images, name))).toString('base64');
          const attempts = [
            await ask(
              server.port,
              model.prompt,
              image,
              model.request.temperature,
              model.request.maxOutputTokens,
            ),
          ];
          if (attempts[0]?.degenerate) {
            attempts.push(
              await ask(
                server.port,
                model.prompt,
                image,
                model.request.temperature,
                model.request.maxOutputTokens,
                Number(values.penalty),
              ),
            );
          }
          pages.push({ name: stem, attempts });
          console.log(
            `${set.name} ${stem} ${attempts.map((a) => `${a.finishReason}/${a.generatedTokens}t/${a.seconds.toFixed(0)}s`).join(' -> ')}`,
          );
          const file = join(outDir, `${set.name}.json`);
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, JSON.stringify(pages));
        }
      }
    } finally {
      await server.stop();
    }
  }
  for (const set of sets) {
    const result = report(set.name, await load(set.name), set.truth);
    for (const row of result.rows) {
      console.log(
        `${result.name} | ${row.condition} | WER ${(row.wer * 100).toFixed(1)} % | WER ohne Fehlerseiten ${(row.werDelivered * 100).toFixed(1)} % | Fehlerseiten ${row.failed} | Schleife im 1. Versuch ${row.loops}/${result.pages} | ${row.seconds} s`,
      );
    }
  }
}

if (import.meta.main) await main();
