import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, hostname } from 'node:os';
import { dirname } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { CONDITIONS, isCondition, loadInputs } from './privacy-inputs.ts';
import type { Condition, WorkInput } from './privacy-inputs.ts';
import {
  buildMessages,
  isVariant,
  locate,
  nachleseMessages,
  parseAnswer,
  schemaFor,
} from './privacy-llm.ts';
import type { ChatMessage, Item, Variant } from './privacy-llm.ts';
import { candidateWords, dictionarySpans, ruleSpans, wordForms } from './privacy-rules.ts';
import { openDictionary } from './ocr-dictionary.ts';
import { join } from 'node:path';
import { privacyCache } from './privacy-inputs.ts';
import type { PrivacySpan } from './privacy-sample.ts';
import { corrector, localFile } from './ocr-registry.ts';
import { detectNames } from '../src/privacy/names.ts';
import { detectRules } from '../src/privacy/rules.ts';
import { launchServer, postJson, readCompletion } from './server.ts';
import type { Server } from './server.ts';

export interface RunItem {
  id: string;
  condition: Condition;
  spans: PrivacySpan[];
  seconds: number;
  promptTokens: number;
  generatedTokens: number;
  items?: Item[];
  raw?: string[];
}

export interface PrivacyRun {
  detector: string;
  machine: string;
  threads: number;
  peakRssBytes: number;
  items: RunItem[];
}

async function ask(server: Server, messages: ChatMessage[], variant: Variant) {
  const started = performance.now();
  const response = await postJson(server.port, '/v1/chat/completions', {
    messages,
    temperature: 0,
    max_tokens: 1024,
    t_max_predict_ms: 120_000,
    cache_prompt: false,
    chat_template_kwargs: { enable_thinking: false },
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'stellen', schema: schemaFor(variant) },
    },
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
  return {
    ...readCompletion(JSON.parse(response.body)),
    seconds: (performance.now() - started) / 1000,
  };
}

async function detectWithModel(
  server: Server,
  input: WorkInput,
  variant: Variant,
  previous: RunItem | undefined,
): Promise<RunItem> {
  const firstVariant = variant === 'nachlese' ? 'beispiele' : variant;
  const first = previous
    ? { ...previous, content: previous.raw?.[0] ?? '' }
    : await ask(server, buildMessages(firstVariant, input.lines, input.context), firstVariant);
  let items = parseAnswer(first.content);
  const raw = [first.content];
  let { seconds, promptTokens, generatedTokens } = first;
  if (variant === 'nachlese') {
    const found = [...new Set(items.map((item) => item.quote))];
    const second = await ask(server, nachleseMessages(input.lines, input.context, found), variant);
    items = [...items, ...parseAnswer(second.content)];
    raw.push(second.content);
    seconds += second.seconds;
    promptTokens += second.promptTokens;
    generatedTokens += second.generatedTokens;
  }
  return {
    id: input.id,
    condition: input.condition,
    spans: locate(input.lines, items),
    seconds,
    promptTokens,
    generatedTokens,
    items,
    raw,
  };
}

async function save(file: string, run: PrivacyRun) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(run)}\n`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      detector: { type: 'string', default: 'llm' },
      model: { type: 'string', default: 'gemma-4-e2b-q4' },
      variant: { type: 'string', default: 'regeln' },
      set: { type: 'string', default: 'dev' },
      conditions: { type: 'string', default: CONDITIONS.join(',') },
      only: { type: 'string' },
      threads: { type: 'string', default: '4' },
      mtp: { type: 'boolean', default: true },
      out: { type: 'string' },
      first: { type: 'string' },
    },
    allowNegative: true,
  });
  if (!values.out) throw new Error('--out angeben');
  const conditions = values.conditions.split(',').filter(isCondition);
  const only = values.only?.split(',');
  const inputs = loadInputs(values.set, conditions).filter(
    (input) => !only || only.includes(input.id),
  );
  const threads = Number(values.threads);
  const name =
    values.detector === 'llm' ? `${values.model}:${values.variant}` : `rules:${values.detector}`;
  const previous: PrivacyRun | undefined = existsSync(values.out)
    ? JSON.parse(readFileSync(values.out, 'utf8'))
    : undefined;
  const run: PrivacyRun = previous ?? {
    detector: name,
    machine: `${hostname()} (${cpus()[0]?.model.trim() ?? 'CPU'})`,
    threads,
    peakRssBytes: 0,
    items: [],
  };
  const todo = inputs.filter(
    (input) =>
      !run.items.some((item) => item.id === input.id && item.condition === input.condition),
  );

  if (values.detector === 'dict' || values.detector === 'dict-cap') {
    const dictionary = await openDictionary(
      join(privacyCache(), 'dictionary.json'),
      process.env['HUNSPELL_DE'] ?? 'de_DE',
    );
    await dictionary.learn(todo.flatMap((input) => candidateWords(input.lines).flatMap(wordForms)));
    await dictionary.save();
    for (const input of todo) {
      const spans = dictionarySpans(
        input.lines,
        input.context,
        (word) => dictionary.isWord(word),
        values.detector === 'dict-cap',
      );
      run.items.push({
        id: input.id,
        condition: input.condition,
        spans,
        seconds: 0,
        promptTokens: 0,
        generatedTokens: 0,
      });
    }
    await save(values.out, run);
    return;
  }

  if (values.detector === 'app' || values.detector === 'app-rules') {
    for (const input of todo) {
      const started = performance.now();
      const spans = [
        ...(await detectRules(input.lines, input.context, AbortSignal.timeout(10_000))),
        ...(values.detector === 'app'
          ? await detectNames(input.lines, input.context, AbortSignal.timeout(10_000))
          : []),
      ];
      run.items.push({
        id: input.id,
        condition: input.condition,
        spans,
        seconds: (performance.now() - started) / 1000,
        promptTokens: 0,
        generatedTokens: 0,
      });
    }
    await save(values.out, run);
    return;
  }

  if (values.detector !== 'llm') {
    const options = {
      triggers: true,
      fuzzy: true,
      firstNames: values.detector === 'names',
    };
    for (const input of todo) {
      const started = performance.now();
      const spans = ruleSpans(input.lines, input.context, options);
      run.items.push({
        id: input.id,
        condition: input.condition,
        spans,
        seconds: (performance.now() - started) / 1000,
        promptTokens: 0,
        generatedTokens: 0,
      });
    }
    await save(values.out, run);
    return;
  }

  const firstRun: PrivacyRun | undefined = values.first
    ? JSON.parse(readFileSync(values.first, 'utf8'))
    : undefined;
  const variant = values.variant;
  if (!isVariant(variant)) throw new Error(`Unbekannte Variante ${variant}`);
  const model = corrector(values.model);
  const draft = model.files.draft;
  const server = await launchServer({
    model: localFile(model.files.model),
    contextSize: model.server.contextSize,
    threads,
    extraArgs: [
      '--no-repack',
      '--reasoning',
      'off',
      ...(values.mtp && draft
        ? ['--spec-type', 'draft-mtp', '--model-draft', localFile(draft)]
        : []),
    ],
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void server.stop().then(() => process.exit(1));
    });
  }
  try {
    await server.ready(300_000);
    for (const input of todo) {
      const earlier = firstRun?.items.find(
        (item) => item.id === input.id && item.condition === input.condition,
      );
      const item = await detectWithModel(server, input, variant, earlier);
      run.items.push(item);
      console.log(
        `${name} ${input.id} ${input.condition} ${item.seconds.toFixed(1)} s, ${item.items?.length ?? 0} Stellen`,
      );
      await save(values.out, run);
    }
  } finally {
    run.peakRssBytes = Math.max(run.peakRssBytes, await server.stop());
    await save(values.out, run);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
