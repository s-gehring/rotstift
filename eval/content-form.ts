import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import {
  PROMPT_VARIANTS,
  buildCheck,
  buildChecklistRequest,
  buildMessages,
} from './content-form-prompt.ts';
import {
  buildFeatureRequest,
  buildSummaryRequest,
  featureSchema,
  featuresFor,
} from './content-form-features.ts';
import { parseReview, serializeReview } from './content-form-review.ts';
import type { ReviewComment } from './content-form-review.ts';
import { defectTable, listing, summaryTable } from './content-form-report.ts';
import type { ReviewDoc, ReviewRun } from './content-form-report.ts';
import { TASK_MODES, parseSample, withTask } from './content-form-sample.ts';
import type { ReviewSample } from './content-form-sample.ts';
import { corrector, localFile } from './ocr-registry.ts';
import { samplesDir } from './paths.ts';
import { launchServer, postJson, readCompletion, record } from './server.ts';

export function loadSamples(filter?: string): ReviewSample[] {
  const dir = join(samplesDir, 'content-form');
  const wanted = filter?.split(',').filter(Boolean);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .toSorted()
    .map((name) => parseSample(basename(name, '.txt'), readFileSync(join(dir, name), 'utf8')))
    .filter((sample) => !wanted || wanted.some((part) => sample.id.includes(part)));
}

async function ask(port: number, messages: unknown, temperature: number, seed: number) {
  const response = await postJson(port, '/v1/chat/completions', {
    messages,
    temperature,
    seed,
    max_tokens: 200,
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
  return readCompletion(JSON.parse(response.body)).content;
}

async function verify(port: number, sample: ReviewSample, output: string) {
  const review = parseReview(output, sample.lines.length);
  const checks: { comment: string; keep: boolean }[] = [];
  for (const comment of review.comments) {
    const response = await postJson(port, '/v1/chat/completions', {
      messages: buildCheck(sample, comment.line, comment.text),
      temperature: 0,
      max_tokens: 2,
      grammar: 'root ::= "ja" | "nein"',
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
    checks.push({
      comment: comment.text,
      keep: readCompletion(JSON.parse(response.body)).content === 'ja',
    });
  }
  const comments = review.comments.filter((_, index) => checks[index]?.keep);
  return { output: serializeReview({ comments, summary: review.summary }), checks };
}

const RUN_VARIANTS = [...PROMPT_VARIANTS, 'features'] as const;

async function featureReview(
  port: number,
  sample: ReviewSample,
  temperature: number,
  seed: number,
) {
  const comments: ReviewComment[] = [];
  const answers: unknown[] = [];
  for (const feature of featuresFor(sample)) {
    const response = await postJson(port, '/v1/chat/completions', {
      messages: buildFeatureRequest(sample, feature),
      temperature,
      seed,
      max_tokens: 80,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'antwort', schema: featureSchema(feature, sample.lines.length) },
      },
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
    const answer = record(JSON.parse(readCompletion(JSON.parse(response.body)).content));
    answers.push({ question: feature.question, ...answer });
    if (answer['erfuellt'] !== false) continue;
    const line = Number(answer['zeile']);
    const written = typeof answer['kommentar'] === 'string' ? answer['kommentar'].trim() : '';
    const text = feature.comment ?? (written || 'Aufgabe nicht erfüllt');
    const taken = comments.some(
      (comment) =>
        comment.text === text || (feature.comment === null && comment.kind === 'content'),
    );
    if (!taken) comments.push({ line, kind: feature.kind, text });
  }
  const findings = comments.map((comment) => comment.text);
  const summary = (await ask(port, buildSummaryRequest(sample, findings), temperature, seed))
    .replaceAll(/\s+/g, ' ')
    .trim();
  return { output: serializeReview({ comments, summary }), answers };
}

async function runReview(
  values: Record<string, string | boolean | undefined>,
  samples: ReviewSample[],
) {
  const string = (key: string, fallback: string) =>
    typeof values[key] === 'string' ? values[key] : fallback;
  const variant = RUN_VARIANTS.find((name) => name === string('variant', 'base'));
  if (!variant) throw new Error(`--variant (${RUN_VARIANTS.join(', ')})`);
  const model = corrector(string('model', 'gemma-4-e2b-q4'));
  const modelFile = string('model-file', localFile(model.files.model));
  const threads = Number(string('threads', '8'));
  const temperature = Number(string('temperature', String(model.request.temperature)));
  const runCount = Number(string('runs', '3'));
  const task = TASK_MODES.find((mode) => mode === string('task', 'keep'));
  if (!task) throw new Error(`--task (${TASK_MODES.join(', ')})`);
  const tasked = withTask(samples, task);
  const server = await launchServer({
    model: modelFile,
    contextSize: model.server.contextSize,
    threads,
    extraArgs: [...(model.server.cpuRepack ? [] : ['--no-repack']), '--reasoning', 'off'],
  });
  const runs: { seed: number; docs: ReviewDoc[] }[] = [];
  let peakRssBytes = 0;
  try {
    await server.ready(300_000);
    for (let run = 0; run < runCount; run += 1) {
      const seed = run + 1;
      const docs: ReviewDoc[] = [];
      for (const sample of tasked) {
        const started = performance.now();
        if (variant === 'features') {
          const result = await featureReview(server.port, sample, temperature, seed);
          const seconds = (performance.now() - started) / 1000;
          docs.push({
            id: sample.id,
            ...result,
            seconds,
            promptTokens: 0,
            generatedTokens: 0,
            finishReason: 'stop',
          });
          console.log(`Lauf ${seed} ${sample.id} ${seconds.toFixed(1)} s`);
          continue;
        }
        const checklist =
          variant === 'checklist'
            ? await ask(server.port, buildChecklistRequest(sample), temperature, seed)
            : '';
        const response = await postJson(server.port, '/v1/chat/completions', {
          messages: buildMessages(sample, variant, checklist),
          temperature,
          seed,
          max_tokens: 512,
        });
        if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
        const json: unknown = JSON.parse(response.body);
        const completion = readCompletion(json);
        const choices = record(json)['choices'];
        const choice = record(Array.isArray(choices) ? choices[0] : undefined);
        const verified = values['verify']
          ? await verify(server.port, sample, completion.content)
          : undefined;
        const seconds = (performance.now() - started) / 1000;
        docs.push({
          id: sample.id,
          output: verified?.output ?? completion.content,
          ...(checklist && { checklist }),
          ...(verified && { rawOutput: completion.content, checks: verified.checks }),
          seconds,
          promptTokens: completion.promptTokens,
          generatedTokens: completion.generatedTokens,
          finishReason:
            typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null,
        });
        console.log(`Lauf ${seed} ${sample.id} ${seconds.toFixed(1)} s`);
      }
      runs.push({ seed, docs });
    }
  } finally {
    peakRssBytes = await server.stop();
  }
  return {
    label: string(
      'label',
      `${basename(modelFile, '.gguf')} ${variant}${values['verify'] ? '+Prüfung' : ''} T=${temperature}${task === 'keep' ? '' : ` ${task}`}`,
    ),
    model: basename(modelFile),
    variant,
    temperature,
    task,
    threads,
    machine: `${hostname()} (${cpus()[0]?.model.trim() ?? 'CPU'})`,
    peakRssBytes,
    runs,
  } satisfies ReviewRun;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string' },
      'model-file': { type: 'string' },
      variant: { type: 'string' },
      temperature: { type: 'string' },
      runs: { type: 'string' },
      threads: { type: 'string' },
      samples: { type: 'string' },
      label: { type: 'string' },
      out: { type: 'string' },
      list: { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
      task: { type: 'string' },
      defects: { type: 'boolean', default: false },
    },
  });
  const samples = loadSamples(values.samples);
  if (positionals.length > 0) {
    const results: ReviewRun[] = positionals.map((file) => JSON.parse(readFileSync(file, 'utf8')));
    console.log(summaryTable(samples, results));
    if (values.defects) console.log(`\n${defectTable(samples, results)}`);
    if (values.list) {
      for (const result of results) {
        result.runs.forEach((run, index) => {
          const tasked = withTask(samples, result.task ?? 'keep');
          console.log(`\n# ${result.label} #${index + 1}\n${listing(tasked, run.docs)}`);
        });
      }
    }
    return;
  }
  if (!values.out) throw new Error('--out <Datei> angeben oder Ergebnisdateien zum Auswerten');
  const result = await runReview(values, samples);
  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(summaryTable(samples, [result]));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
