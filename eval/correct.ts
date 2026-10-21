import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { parseTranscript } from '../src/annotations/parse.ts';
import type { ParseIssue } from '../src/annotations/parse.ts';
import { DEUTSCH } from '../src/annotations/profile.ts';
import { scopedProfile, type CorrectionScope } from '../src/correction/scope.ts';
import { serializeTranscript } from '../src/annotations/serialize.ts';
import type { Transcript } from '../src/annotations/transcript.ts';
import { countWords } from '../src/stats/count-words.ts';
import { installDom } from './dom.ts';
import { CORRECTORS } from './correct-models.ts';
import type { Corrector } from './correct-models.ts';
import { diffAnswer, diffMessages, diffRepairMessages } from './correct-diff.ts';
import { listMessages, listRepairMessages, listSchema, listToTranscript } from './correct-list.ts';
import {
  PROMPT_VARIANTS,
  buildMessages,
  repairMessages,
  scopeFromArgs,
} from './correct-prompts.ts';
import type { ChatMessage, PromptVariant } from './correct-prompts.ts';
import { correctorReport } from './correct-report.ts';
import type { CorrectorRun, DocResult, Group } from './correct-report.ts';
import { DEFAULT_LINE_CHARS, goldFromMarkup, transcriptFromText } from './gold.ts';
import { cleanTranscript } from './metrics.ts';
import { preservedLines, remapGold, scorePage } from './mark-metrics.ts';
import { evalDir, modelsDir, samplesDir } from './paths.ts';
import type { ModelRun } from './report.ts';
import { parseSample } from './sample.ts';
import { launchServer, postJson, readCompletion } from './server.ts';
import type { Server } from './server.ts';

interface Doc {
  id: string;
  group: Group;
  input: Transcript;
  gold: Transcript;
  words: number;
  recoverable?: number;
  total?: number;
}

type Format = 'tags' | 'list' | 'diff';

const FORMATS: readonly Format[] = ['tags', 'list', 'diff'];

interface Options {
  threads: number;
  contextSize: number;
  maxTokens: number;
  prompt: PromptVariant;
  format: Format;
  batchSize: number | undefined;
  ubatchSize: number | undefined;
  serverArgs: string[];
  repair: boolean;
  scope: CorrectionScope;
}

function plainWords(transcript: Transcript): number {
  return countWords(transcript.lines.map((line) => line.text).join('\n'));
}

function sampleDocs(width: number, filter: string[] | undefined): Doc[] {
  const dir = join(samplesDir, 'texts');
  return readdirSync(dir)
    .toSorted()
    .filter((name) => name.endsWith('.txt') && (!filter || filter.includes(basename(name, '.txt'))))
    .flatMap((name): Doc[] => {
      const id = basename(name, '.txt');
      const markup = readFileSync(join(dir, name), 'utf8').trim();
      const marked = goldFromMarkup(markup, width);
      const clean = goldFromMarkup(parseSample(markup).corrected, width);
      return [
        {
          id,
          group: 'fehler',
          input: marked.input,
          gold: marked.gold,
          words: plainWords(marked.input),
        },
        {
          id: `${id}-fehlerfrei`,
          group: 'fehlerfrei',
          input: clean.input,
          gold: clean.gold,
          words: plainWords(clean.input),
        },
      ];
    });
}

function scadsDocs(root: string, count: number, width: number): Doc[] {
  const dir = join(root, 'ground_truth');
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .toSorted();
  const step = Math.max(1, Math.floor(names.length / count));
  return names
    .filter((_, index) => index % step === 0)
    .slice(0, count)
    .map((name) => {
      const text = readFileSync(join(dir, name), 'utf8').replaceAll(/[{}|]/g, ' ').trim();
      const { input, gold } = goldFromMarkup(text, width);
      return {
        id: `scads-${basename(name, '.txt')}`,
        group: 'scads',
        input,
        gold,
        words: plainWords(input),
      };
    });
}

async function ocrDocs(file: string, width: number): Promise<Doc[]> {
  const run: ModelRun = JSON.parse(await readFile(file, 'utf8'));
  return run.pages.map((page) => {
    const markup = readFileSync(join(samplesDir, 'texts', `${page.text}.txt`), 'utf8').trim();
    const input = transcriptFromText(page.transcript, width);
    const mapped = remapGold(goldFromMarkup(markup, width).gold, input);
    return {
      id: `${page.text}--${page.font}`,
      group: 'ocr',
      input,
      gold: mapped.gold,
      words: plainWords(input),
      recoverable: mapped.recoverable,
      total: mapped.total,
    };
  });
}

async function complete(server: Server, messages: readonly ChatMessage[], options: Options) {
  const started = performance.now();
  const response = await postJson(server.port, '/v1/chat/completions', {
    messages,
    temperature: 0,
    max_tokens: options.maxTokens,
    cache_prompt: false,
    chat_template_kwargs: { enable_thinking: false },
    ...(options.format === 'list'
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'errors',
              schema: listSchema(scopedProfile(DEUTSCH, options.scope)),
            },
          },
        }
      : {}),
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
  const completion = readCompletion(JSON.parse(response.body));
  return { ...completion, seconds: (performance.now() - started) / 1000 };
}

interface Judgement {
  transcript: Transcript | undefined;
  issues: ParseIssue[];
  items: number | undefined;
}

function judge(doc: Doc, answer: string, options: Options): Judgement {
  const profile = scopedProfile(DEUTSCH, options.scope);
  if (options.format === 'tags') {
    const parsed = parseTranscript(answer, { profile, source: doc.input });
    return parsed.ok
      ? { transcript: parsed.transcript, issues: [], items: undefined }
      : { transcript: undefined, issues: parsed.issues, items: undefined };
  }
  if (options.format === 'diff') {
    const { transcript, issues } = diffAnswer(doc.input, answer, profile);
    const parsed = parseTranscript(serializeTranscript(transcript), {
      profile,
      source: doc.input,
    });
    return {
      transcript: parsed.ok ? parsed.transcript : undefined,
      issues: [...issues.map((message) => ({ message })), ...(parsed.ok ? [] : parsed.issues)],
      items: undefined,
    };
  }
  const list = listToTranscript(doc.input, answer);
  const parsed = parseTranscript(serializeTranscript(list.transcript), {
    profile,
    source: doc.input,
  });
  const issues = [
    ...list.issues.map((message) => ({ message })),
    ...(parsed.ok ? [] : parsed.issues),
  ];
  return { transcript: parsed.ok ? parsed.transcript : undefined, issues, items: list.items };
}

async function correct(server: Server, doc: Doc, options: Options): Promise<DocResult> {
  const messages = {
    tags: () => buildMessages(options.prompt, DEUTSCH, doc.input, options.scope),
    list: () => listMessages(scopedProfile(DEUTSCH, options.scope), doc.input, options.scope),
    diff: () => diffMessages(DEUTSCH, doc.input, options.prompt, options.scope),
  }[options.format]();
  const first = await complete(server, messages, options);
  let answer = cleanTranscript(first.content);
  let judgement = judge(doc, answer, options);
  const firstAccepted = judgement.issues.length === 0;
  const issues = judgement.issues.map((issue) => issue.message);
  let seconds = first.seconds;
  let promptTokens = first.promptTokens;
  let generatedTokens = first.generatedTokens;
  if (judgement.issues.length > 0 && options.repair) {
    const retry = {
      tags: () => repairMessages(messages, answer, judgement.issues),
      list: () => listRepairMessages(messages, answer, issues),
      diff: () => diffRepairMessages(messages, answer, issues),
    }[options.format]();
    const second = await complete(server, retry, options);
    answer = cleanTranscript(second.content);
    judgement = judge(doc, answer, options);
    seconds += second.seconds;
    promptTokens += second.promptTokens;
    generatedTokens += second.generatedTokens;
  }
  return {
    id: doc.id,
    group: doc.group,
    words: doc.words,
    lines: doc.input.lines.length,
    seconds,
    promptTokens,
    generatedTokens,
    firstAccepted,
    ...assess(doc, answer, judgement, options),
    issues,
  };
}

function assess(doc: Doc, answer: string, judgement: Judgement, options: Options) {
  return {
    accepted: judgement.transcript !== undefined,
    output: answer,
    preservedLines:
      options.format === 'tags' ? preservedLines(doc.input, answer) : doc.input.lines.length,
    marks: (judgement.transcript?.lines ?? []).flatMap((line) =>
      line.marks.map((mark) => ({ ...mark, line: line.number })),
    ),
    score: scorePage(doc.input, doc.gold, judgement.transcript),
    ...(options.format === 'list' ? { unlocated: judgement.issues.length } : {}),
    ...(options.format === 'diff' ? { collapsed: collapsed(doc, answer) } : {}),
    ...(doc.recoverable === undefined ? {} : { recoverable: doc.recoverable, total: doc.total }),
  };
}

function collapsed(doc: Doc, answer: string): number {
  return diffAnswer(doc.input, answer).collapsed;
}

async function rescore(
  run: CorrectorRun,
  docs: readonly Doc[],
  options: Options,
): Promise<CorrectorRun> {
  return {
    ...run,
    docs: run.docs.flatMap((result) => {
      const doc = docs.find((entry) => entry.id === result.id);
      if (!doc) return [];
      const judgement = judge(doc, result.output, options);
      return [{ ...result, ...assess(doc, result.output, judgement, options) }];
    }),
  };
}

async function evaluate(
  corrector: Corrector,
  docs: Doc[],
  options: Options,
): Promise<CorrectorRun> {
  const server = await launchServer({
    model: join(modelsDir(), corrector.model.name),
    contextSize: options.contextSize,
    threads: options.threads,
    batchSize: options.batchSize,
    ubatchSize: options.ubatchSize,
    extraArgs: options.serverArgs,
  });
  const run: CorrectorRun = {
    id: corrector.id,
    label: corrector.label,
    license: corrector.license,
    bytes: corrector.model.bytes,
    threads: options.threads,
    contextSize: options.contextSize,
    prompt: options.format === 'list' ? 'list' : options.prompt,
    loadSeconds: 0,
    peakRssBytes: 0,
    docs: [],
  };
  const started = performance.now();
  try {
    await server.ready(10 * 60_000);
    run.loadSeconds = (performance.now() - started) / 1000;
    for (const doc of docs) {
      const result = await correct(server, doc, options);
      run.docs.push(result);
      console.log(
        `  ${doc.id}: ${result.seconds.toFixed(1)} s, ${result.firstAccepted ? 'ok' : result.accepted ? 'repaired' : 'rejected'}, ` +
          `${result.score.matched}/${result.score.gold} marks, ${result.score.predicted - result.score.matched} false`,
      );
    }
  } catch (error) {
    run.failure = `${error instanceof Error ? error.message : String(error)}\n${server.log()}`;
    console.error(`  ${corrector.id} failed: ${run.failure}`);
  } finally {
    run.peakRssBytes = await server.stop();
  }
  return run;
}

async function main() {
  installDom();
  const { values } = parseArgs({
    options: {
      models: { type: 'string' },
      texts: { type: 'string' },
      groups: { type: 'string', default: 'fehler,fehlerfrei' },
      scads: {
        type: 'string',
        default: join(homedir(), '.cache/rotstift/datasets/scads-fullpage/extracted'),
      },
      'scads-count': { type: 'string', default: '12' },
      ocr: { type: 'string' },
      threads: { type: 'string', default: '4' },
      'ctx-size': { type: 'string', default: '4096' },
      'max-tokens': { type: 'string', default: '2048' },
      'line-chars': { type: 'string', default: String(DEFAULT_LINE_CHARS) },
      prompt: { type: 'string', default: 'spec' },
      format: { type: 'string', default: 'tags' },
      'batch-size': { type: 'string' },
      'ubatch-size': { type: 'string' },
      'server-args': { type: 'string', default: '' },
      'no-repair': { type: 'boolean', default: false },
      scope: { type: 'string', default: 'all' },
      assignment: { type: 'string', default: '' },
      out: { type: 'string' },
      rescore: { type: 'string' },
    },
  });
  const prompt = PROMPT_VARIANTS.find((variant) => variant === values.prompt);
  if (!prompt)
    throw new Error(`Unknown prompt ${values.prompt}, use one of ${PROMPT_VARIANTS.join(', ')}`);
  const format = FORMATS.find((entry) => entry === values.format);
  if (!format) throw new Error(`Unknown format ${values.format}, use one of ${FORMATS.join(', ')}`);
  const options: Options = {
    threads: Number(values.threads),
    contextSize: Number(values['ctx-size']),
    maxTokens: Number(values['max-tokens']),
    prompt,
    format,
    batchSize: values['batch-size'] ? Number(values['batch-size']) : undefined,
    ubatchSize: values['ubatch-size'] ? Number(values['ubatch-size']) : undefined,
    serverArgs: values['server-args'].split(' ').filter((argument) => argument !== ''),
    repair: !values['no-repair'],
    scope: scopeFromArgs(values.scope, values.assignment),
  };
  const width = Number(values['line-chars']);
  const groups = new Set(values.groups.split(','));
  const docs: Doc[] = [];
  if (groups.has('fehler') || groups.has('fehlerfrei')) {
    docs.push(
      ...sampleDocs(width, values.texts?.split(',')).filter((doc) => groups.has(doc.group)),
    );
  }
  if (groups.has('scads'))
    docs.push(...scadsDocs(values.scads, Number(values['scads-count']), width));
  if (groups.has('ocr')) {
    if (!values.ocr) throw new Error('--ocr <glm-ocr.json> is required for the ocr group');
    docs.push(...(await ocrDocs(values.ocr, width)));
  }
  if (docs.length === 0) throw new Error('No texts selected');

  const wanted = values.models?.split(',');
  const correctors = wanted
    ? wanted.map((id) => {
        const corrector = CORRECTORS.find((entry) => entry.id === id);
        if (!corrector) throw new Error(`Unknown model ${id}`);
        return corrector;
      })
    : CORRECTORS;
  const out =
    values.out ??
    join(
      evalDir,
      'results',
      `korrektur-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`,
    );
  await mkdir(out, { recursive: true });

  const runs: CorrectorRun[] = [];
  for (const corrector of correctors) {
    if (values.rescore) {
      const source = join(values.rescore, `${corrector.id}.json`);
      if (!existsSync(source)) continue;
      const run = await rescore(JSON.parse(await readFile(source, 'utf8')), docs, options);
      await writeFile(join(out, `${corrector.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
      runs.push(run);
      continue;
    }
    const file = join(out, `${corrector.id}.json`);
    if (existsSync(file)) {
      runs.push(JSON.parse(await readFile(file, 'utf8')));
      continue;
    }
    if (!existsSync(join(modelsDir(), corrector.model.name))) {
      console.log(`${corrector.label}: skipped, run eval/download-models.ts first`);
      continue;
    }
    console.log(corrector.label);
    const run = await evaluate(corrector, docs, options);
    await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
    runs.push(run);
  }

  const summary = correctorReport(
    runs,
    `Texte: ${docs.length}, Threads: ${options.threads}, Kontext: ${options.contextSize}, Format: ${options.format}, Prompt: ${options.format === 'list' ? 'list' : options.prompt}, nur CPU (-ngl 0, --device none)`,
  );
  await writeFile(join(out, 'summary.md'), summary);
  console.log(`\n${summary}\nResults: ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
