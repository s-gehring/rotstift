import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEUTSCH } from '../src/annotations/profile.ts';
import { correctPage } from '../src/correction/correct-page.ts';
import { createLlmCorrector } from '../src/correction/llm-corrector.ts';
import type { LlmClient } from '../src/llm/client.ts';
import { correctorConfig } from '../src/llm/sidecar-corrector.ts';
import { readJpeg } from '../src/layout/image-files.ts';
import { findStruckWords } from '../src/layout/strike.ts';
import { markStruck } from '../src/annotations/struck.ts';
import { parseTranscript } from '../src/pipeline/transcript-lines.ts';
import { installDom } from './dom.ts';
import { corrector, localFile } from './ocr-registry.ts';
import type { OcrRun } from './ocr-run.ts';
import { launchServer, postJson, record } from './server.ts';
import { canonicalStrikes } from './strike.ts';
import { alignTokens, tokens } from './strike-score.ts';

interface MarkedPage {
  name: string;
  lines: string[];
  truthStruck: number[];
}

export interface StrikeCorrection {
  name: string;
  ok: boolean;
  words: number;
  marks: number;
  onStruck: number;
}

const WORD = /\S+/gu;

function markedPages(ocrFile: string, imageDir: string, truthDir: string, ink: boolean) {
  const run: OcrRun = JSON.parse(readFileSync(ocrFile, 'utf8'));
  return run.pages.flatMap((page): MarkedPage[] => {
    const truthFile = join(truthDir, `${page.name}.txt`);
    if (!existsSync(truthFile) || page.finishReason !== 'stop') return [];
    const plain = parseTranscript(canonicalStrikes(page.content).replace(/~~/gu, '')).lines;
    const struck = ink
      ? findStruckWords(readJpeg(join(imageDir, `${page.name}.jpg`)), plain)
      : plain.map(() => []);
    const lines = plain.map((line, index) => markStruck(line, struck[index] ?? []));
    const hypothesis = plain.flatMap((line) => tokens(line));
    const truth = tokens(readFileSync(truthFile, 'utf8'));
    const matched = alignTokens(
      truth,
      hypothesis.map((token) => ({ ...token, struck: false })),
    );
    const truthStruck = truth.flatMap((token, index) => {
      const at = matched[index];
      return token.struck && at !== null && at !== undefined ? [at] : [];
    });
    return [{ name: page.name, lines, truthStruck }];
  });
}

function wordStarts(text: string): number[] {
  return Array.from(text.matchAll(WORD), (match) => match.index);
}

async function main() {
  installDom();
  const { values } = parseArgs({
    options: {
      ocr: { type: 'string', multiple: true },
      images: { type: 'string', multiple: true },
      truth: { type: 'string', multiple: true },
      method: { type: 'string', default: 'ink' },
      model: { type: 'string', default: 'gemma-4-e2b-q4' },
      threads: { type: 'string', default: '8' },
      out: { type: 'string' },
    },
  });
  if (!values.ocr || !values.truth || !values.images || !values.out)
    throw new Error('--ocr, --images, --truth (paarweise) und --out angeben');
  const pages = values.ocr.flatMap((ocr, set) =>
    markedPages(
      ocr,
      values.images?.[set] ?? '',
      values.truth?.[set] ?? '',
      values.method === 'ink',
    ),
  );
  const done: StrikeCorrection[] = existsSync(values.out)
    ? JSON.parse(readFileSync(values.out, 'utf8'))
    : [];
  const model = corrector(values.model);
  const todo = pages.filter((page) => !done.some((entry) => entry.name === page.name));
  if (todo.length > 0) {
    const server = await launchServer({
      model: localFile(model.files.model),
      contextSize: model.server.contextSize,
      threads: Number(values.threads),
      extraArgs: [
        ...(model.server.cpuRepack ? [] : ['--no-repack']),
        ...(model.server.reasoning === 'off' ? ['--reasoning', 'off'] : []),
      ],
    });
    try {
      await server.ready(300_000);
      const client: Pick<LlmClient, 'complete'> = {
        async complete(request) {
          const response = await postJson(server.port, '/v1/chat/completions', request);
          if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
          const json = record(JSON.parse(response.body));
          const choice = record(Array.isArray(json['choices']) ? json['choices'][0] : undefined);
          const content = record(choice['message'])['content'];
          return {
            text: typeof content === 'string' ? content : '',
            finishReason:
              typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null,
          };
        },
      };
      for (const page of todo) {
        const result = await correctPage({
          lines: page.lines,
          profile: DEUTSCH,
          corrector: createLlmCorrector({ client, config: correctorConfig(model) }),
        });
        let words = 0;
        let marks = 0;
        let onStruck = 0;
        const truthStruck = new Set(page.truthStruck);
        let offset = 0;
        page.lines.forEach((line, index) => {
          const visible = tokens(line).filter((token) => !token.struck).length;
          words += visible;
          const transcriptLine = result.ok ? result.transcript.lines[index] : undefined;
          const starts = transcriptLine ? wordStarts(transcriptLine.text) : [];
          for (const mark of transcriptLine?.marks ?? []) {
            marks += 1;
            const word = starts.findLastIndex((start) => start <= mark.offset);
            if (truthStruck.has(offset + Math.max(0, word))) onStruck += 1;
          }
          offset += tokens(line).length;
        });
        done.push({ name: page.name, ok: result.ok, words, marks, onStruck });
        console.log(
          `${page.name} ${result.ok ? 'ok' : 'fehler'} ${marks} Marken, ${onStruck} auf Gestrichenem`,
        );
        await mkdir(dirname(values.out), { recursive: true });
        await writeFile(values.out, `${JSON.stringify(done)}\n`);
      }
    } finally {
      await server.stop();
    }
  }
  const ok = done.filter((entry) => entry.ok);
  const sum = (key: 'words' | 'marks' | 'onStruck') =>
    ok.reduce((total, entry) => total + entry[key], 0);
  const per100 = (count: number) => ((100 * count) / Math.max(1, sum('words'))).toFixed(2);
  console.log(
    `Seiten: ${ok.length} (${done.length - ok.length} fehlgeschlagen), Wörter: ${sum('words')}`,
  );
  console.log(`Marken je 100 Wörter: ${per100(sum('marks'))}`);
  console.log(
    `Marken auf gestrichenen Wörtern: ${sum('onStruck')}, je 100 Wörter ${per100(sum('onStruck'))}`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
