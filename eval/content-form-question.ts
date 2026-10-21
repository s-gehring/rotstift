import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { formRequest, questionRequest, quoteLine, readAnswer } from '../src/content-form/review.ts';
import { DEFAULT_SCOPE } from '../src/correction/scope.ts';
import { sampleInput } from './content-form-features.ts';
import { matches } from './content-form-review.ts';
import { parseSample } from './content-form-sample.ts';
import type { ReviewSample } from './content-form-sample.ts';
import { corrector, localFile } from './ocr-registry.ts';
import { samplesDir } from './paths.ts';
import { launchServer, postJson, readCompletion, record } from './server.ts';

function samplesIn(dir: string, filter: readonly string[]): ReviewSample[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .toSorted()
    .map((name) => parseSample(basename(name, '.txt'), readFileSync(join(dir, name), 'utf8')))
    .filter((sample) => filter.length === 0 || filter.some((part) => sample.id.includes(part)));
}

async function main() {
  const { values } = parseArgs({
    options: {
      question: { type: 'string', multiple: true },
      map: { type: 'string', multiple: true },
      assignment: { type: 'string' },
      comment: { type: 'string' },
      form: { type: 'string', multiple: true },
      samples: { type: 'string' },
      dir: { type: 'string', multiple: true },
      threads: { type: 'string' },
    },
  });
  const questions = values.question ?? [];
  const names = values.map ?? [];
  if (questions.length === 0 && names.length === 0) {
    throw new Error('--question <Frage> oder --map <Textform> angeben, mehrfach möglich');
  }
  const comment = values.comment ?? 'Mangel';
  const filter = values.samples?.split(',').filter(Boolean) ?? [];
  const dirs = (values.dir ?? ['content-form']).map((dir) => join(samplesDir, dir));
  const samples = dirs.flatMap((dir) => samplesIn(dir, filter));
  const model = corrector('gemma-4-e2b-q4');
  const server = await launchServer({
    model: localFile(model.files.model),
    contextSize: model.server.contextSize,
    threads: Number(values.threads ?? '8'),
    extraArgs: [...(model.server.cpuRepack ? [] : ['--no-repack']), '--reasoning', 'off'],
  });
  try {
    await server.ready(300_000);
    for (const name of names) {
      const request = formRequest({
        ...DEFAULT_SCOPE,
        form: true,
        formName: name,
        assignment: values.assignment ?? '',
      });
      const response = await postJson(server.port, '/v1/chat/completions', {
        messages: request.messages,
        temperature: 0,
        max_tokens: 96,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'antwort', schema: request.schema },
        },
      });
      const json: unknown = JSON.parse(response.body);
      const choices = record(json)['choices'];
      const reason = record(Array.isArray(choices) ? choices[0] : undefined)['finish_reason'];
      console.log(`${name}: ${JSON.stringify(readCompletion(json).content)} (${String(reason)})`);
    }
    const lines = new Map(questions.map((question) => [question, [] as string[]]));
    for (const sample of samples) {
      for (const form of values.form ?? [sample.form]) {
        for (const question of questions) {
          const input = sampleInput({ ...sample, form });
          const asked = { kind: 'form', question, comment } as const;
          const request = questionRequest(input, asked);
          const response = await postJson(server.port, '/v1/chat/completions', {
            messages: request.messages,
            temperature: 0,
            max_tokens: 96,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'antwort', schema: request.schema },
            },
          });
          const answer = readCompletion(JSON.parse(response.body)).content;
          const read = readAnswer(answer, asked);
          const line = (quoteLine(input.lines, read?.quote ?? '') ?? 0) + 1;
          const parsed = { erfuellt: read?.met ?? true, zeile: line };
          const expected = sample.defects.filter((defect) => matches(defect, comment));
          const hit =
            !parsed.erfuellt && expected.some((defect) => matches(defect, comment, parsed.zeile));
          const verdict =
            expected.length === 0
              ? parsed.erfuellt
                ? 'richtig ja'
                : 'FEHLALARM'
              : parsed.erfuellt
                ? 'VERFEHLT'
                : hit
                  ? 'getroffen'
                  : 'nein, Zeile daneben';
          lines
            .get(question)
            ?.push(
              `${sample.id} (${form}): ${verdict} Z. ${line} ${answer.replaceAll(/\s+/gu, ' ')}`,
            );
        }
      }
    }
    for (const [question, rows] of lines) console.log(`\n# ${question}\n${rows.join('\n')}`);
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
