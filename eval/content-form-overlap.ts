import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEUTSCH } from '../src/annotations/profile.ts';
import { coveringCodes, coveringMark } from '../src/content-form/overlap.ts';
import { reviewContent } from '../src/content-form/review.ts';
import { correctPage } from '../src/correction/correct-page.ts';
import { createLlmCorrector } from '../src/correction/llm-corrector.ts';
import type { LlmClient } from '../src/llm/client.ts';
import { correctorConfig } from '../src/llm/sidecar-corrector.ts';
import { sampleInput } from './content-form-features.ts';
import { loadSamples } from './content-form.ts';
import { installDom } from './dom.ts';
import { corrector, localFile } from './ocr-registry.ts';
import { launchServer, postJson, readCompletion, record } from './server.ts';

const NEAR_LINES = 2;

async function main() {
  const { values } = parseArgs({
    options: {
      samples: { type: 'string' },
      threads: { type: 'string', default: '8' },
    },
  });
  installDom();
  const model = corrector('gemma-4-e2b-q4');
  const server = await launchServer({
    model: localFile(model.files.model),
    contextSize: model.server.contextSize,
    threads: Number(values.threads),
    extraArgs: [...(model.server.cpuRepack ? [] : ['--no-repack']), '--reasoning', 'off'],
  });
  try {
    await server.ready(300_000);
    const client: Pick<LlmClient, 'complete'> = {
      async complete(request) {
        const response = await postJson(server.port, '/v1/chat/completions', request);
        if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
        const json = record(JSON.parse(response.body));
        const choice = record(Array.isArray(json['choices']) ? json['choices'][0] : undefined);
        return {
          text: readCompletion(json).content,
          finishReason:
            typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null,
        };
      },
    };
    const signal = new AbortController().signal;
    let comments = 0;
    let merged = 0;
    const rows: string[] = [];
    for (const sample of loadSamples(values.samples)) {
      const input = sampleInput(sample);
      const corrected = await correctPage({
        lines: sample.lines,
        profile: DEUTSCH,
        corrector: createLlmCorrector({ client, config: correctorConfig(model) }),
        signal,
      });
      if (!corrected.ok) throw new Error(`${sample.id}: ${JSON.stringify(corrected.error)}`);
      const review = await reviewContent(
        { ...input, profile: { ...DEUTSCH, subject: sample.subject } },
        async (request) => {
          const answer = await client.complete({
            messages: [...request.messages],
            temperature: 0,
            max_tokens: 96,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'antwort', schema: request.schema },
            },
          });
          return answer.text;
        },
        signal,
      );
      if (!review.ok) throw new Error(`${sample.id}: ${JSON.stringify(review.error)}`);
      for (const comment of review.comments) {
        comments += 1;
        const covered = coveringMark(comment, corrected.transcript, DEUTSCH);
        const codes = new Set(coveringCodes(comment.text, DEUTSCH));
        const near = corrected.transcript.lines
          .filter((line) => Math.abs(line.number - comment.line) <= NEAR_LINES)
          .flatMap((line) =>
            line.marks
              .filter((mark) => codes.has(mark.type))
              .map((mark) => `${mark.type}@${line.number}`),
          );
        if (covered !== null) merged += 1;
        if (covered !== null || near.length > 0) {
          rows.push(
            `| ${sample.id} | ${comment.line} | ${comment.text} | ${covered ?? '–'} | ${near.join(', ') || '–'} |`,
          );
        }
      }
    }
    console.log(
      [
        `Kommentare: ${comments}, zusammengeführt: ${merged}`,
        '',
        '| Probe | Zeile | Kommentar | Marke gleiche Zeile | Passende Marken ±2 Zeilen |',
        '| --- | --- | --- | --- | --- |',
        ...rows,
      ].join('\n'),
    );
  } finally {
    await server.stop();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
