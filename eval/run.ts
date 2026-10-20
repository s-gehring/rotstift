import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { countWords } from '../src/stats/count-words.ts';
import { characterEdits, classifyErrors, cleanTranscript, wordEdits } from './metrics.ts';
import { CANDIDATES, PROMPTS, TRANSCRIBE_PROMPT } from './models.ts';
import type { Candidate } from './models.ts';
import { evalDir, modelsDir, samplesDir } from './paths.ts';
import {
  cerByFontTable,
  overviewTable,
  preservationByKindTable,
  summarize,
  wordCountByPageTable,
} from './report.ts';
import type { ModelRun, PageResult } from './report.ts';
import { launchServer, postJson, readCompletion } from './server.ts';
import { parseSample } from './sample.ts';
import type { Sample } from './sample.ts';

interface Page {
  image: string;
  text: string;
  font: string;
  sample: Sample;
}

interface Options {
  threads: number;
  contextSize: number;
  maxTokens: number;
  imageMaxTokens: number | undefined;
  prompt: string;
}

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function datasetPages(dir: string): Page[] {
  const imagesDir = join(dir, 'images');
  return readdirSync(imagesDir)
    .toSorted()
    .flatMap((name): Page[] => {
      const text = basename(name, extname(name));
      const truth = join(dir, 'ground_truth', `${text}.txt`);
      if (!IMAGE_TYPES[extname(name).toLowerCase()] || !existsSync(truth)) return [];
      const written = readFileSync(truth, 'utf8').trim();
      return [
        {
          image: join(imagesDir, name),
          text,
          font: 'handschrift',
          sample: { written, corrected: written, errors: [] },
        },
      ];
    });
}

function samplePages(): Page[] {
  const pages: Page[] = [];
  const renderedDir = join(samplesDir, 'rendered');
  if (existsSync(renderedDir)) {
    for (const name of readdirSync(renderedDir).toSorted()) {
      const match = /^(.+)--(.+)\.jpg$/.exec(name);
      if (!match?.[1] || !match[2]) continue;
      const markup = readFileSync(join(samplesDir, 'texts', `${match[1]}.txt`), 'utf8');
      pages.push({
        image: join(renderedDir, name),
        text: match[1],
        font: match[2],
        sample: parseSample(markup.trim()),
      });
    }
  }
  const scansDir = join(samplesDir, 'scans');
  for (const name of readdirSync(scansDir).toSorted()) {
    const extension = extname(name).toLowerCase();
    const truth = join(scansDir, `${basename(name, extname(name))}.txt`);
    if (!IMAGE_TYPES[extension] || !existsSync(truth)) continue;
    pages.push({
      image: join(scansDir, name),
      text: basename(name, extname(name)),
      font: 'scan',
      sample: parseSample(readFileSync(truth, 'utf8').trim()),
    });
  }
  return pages;
}

function selectPages(pages: Page[], filter: string[] | undefined): Page[] {
  return filter
    ? pages.filter((page) => filter.some((part) => basename(page.image).includes(part)))
    : pages;
}

async function transcribe(port: number, candidate: Candidate, page: Page, options: Options) {
  const type = IMAGE_TYPES[extname(page.image).toLowerCase()] ?? 'image/jpeg';
  const image = (await readFile(page.image)).toString('base64');
  const content: unknown[] = [
    { type: 'image_url', image_url: { url: `data:${type};base64,${image}` } },
  ];
  const prompt = promptFor(candidate, options);
  if (prompt) content.push({ type: 'text', text: prompt });
  const started = performance.now();
  const response = await postJson(port, '/v1/chat/completions', {
    messages: [{ role: 'user', content }],
    temperature: 0,
    max_tokens: options.maxTokens,
    cache_prompt: false,
    chat_template_kwargs: { enable_thinking: false },
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
  const completion = readCompletion(JSON.parse(response.body));
  return { ...completion, seconds: (performance.now() - started) / 1000 };
}

function promptFor(candidate: Candidate, options: Options): string | null {
  return candidate.prompt === TRANSCRIBE_PROMPT
    ? (PROMPTS[options.prompt] ?? TRANSCRIBE_PROMPT)
    : candidate.prompt;
}

async function evaluate(candidate: Candidate, pages: Page[], options: Options): Promise<ModelRun> {
  const dir = modelsDir();
  const server = await launchServer({
    model: join(dir, candidate.model.name),
    mmproj: join(dir, candidate.mmproj.name),
    contextSize: options.contextSize,
    threads: options.threads,
    imageMaxTokens: options.imageMaxTokens,
  });
  const port = server.port;

  const run: ModelRun = {
    id: candidate.id,
    label: candidate.label,
    license: candidate.license,
    bytes: candidate.model.bytes + candidate.mmproj.bytes,
    threads: options.threads,
    contextSize: options.contextSize,
    imageMaxTokens: options.imageMaxTokens,
    prompt: candidate.prompt === TRANSCRIBE_PROMPT ? options.prompt : 'model',
    loadSeconds: 0,
    peakRssBytes: 0,
    pages: [],
  };
  const started = performance.now();
  try {
    await server.ready(10 * 60_000);
    run.loadSeconds = (performance.now() - started) / 1000;
    for (const page of pages) {
      const result = await transcribe(port, candidate, page, options);
      const transcript = cleanTranscript(result.content);
      const chars = characterEdits(page.sample.written, transcript);
      const words = wordEdits(page.sample.written, transcript);
      const pageResult: PageResult = {
        image: basename(page.image),
        text: page.text,
        font: page.font,
        seconds: result.seconds,
        promptTokens: result.promptTokens,
        generatedTokens: result.generatedTokens,
        charEdits: chars.edits,
        charCount: chars.total,
        wordEdits: words.edits,
        wordCount: words.total,
        errors: classifyErrors(page.sample, transcript),
        transcript,
        expectedWords: countWords(page.sample.written),
        transcribedWords: countWords(transcript),
      };
      run.pages.push(pageResult);
      console.log(
        `  ${pageResult.image}: ${result.seconds.toFixed(1)} s, CER ${((100 * chars.edits) / Math.max(chars.total, 1)).toFixed(1)} %`,
      );
    }
  } catch (error) {
    run.failure = `${error instanceof Error ? error.message : String(error)}\n${server.log()}`;
    console.error(`  ${candidate.id} failed: ${run.failure}`);
  } finally {
    run.peakRssBytes = await server.stop();
  }
  return run;
}

function report(runs: ModelRun[], pages: Page[], options: Options): string {
  return [
    `Seiten: ${pages.length}, Threads: ${options.threads}, Kontext: ${options.contextSize}, ` +
      `Bild-Token max.: ${options.imageMaxTokens ?? 'Modellstandard'}, Prompt: ${options.prompt}, ` +
      'nur CPU (-ngl 0, --device none)',
    '',
    overviewTable(runs.map(summarize)),
    '',
    'Abweichung der Wortzahl je Seite:',
    '',
    wordCountByPageTable(runs),
    '',
    'CER je Schrift:',
    '',
    cerByFontTable(runs),
    '',
    'Erhaltene Fehler je Fehlerart:',
    '',
    preservationByKindTable(runs),
    '',
  ].join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      models: { type: 'string' },
      samples: { type: 'string' },
      dataset: { type: 'string' },
      threads: { type: 'string', default: '4' },
      'ctx-size': { type: 'string', default: '8192' },
      'max-tokens': { type: 'string', default: '1536' },
      'image-max-tokens': { type: 'string' },
      prompt: { type: 'string', default: 'standard' },
      out: { type: 'string' },
    },
  });
  const options: Options = {
    threads: Number(values.threads),
    contextSize: Number(values['ctx-size']),
    maxTokens: Number(values['max-tokens']),
    imageMaxTokens: values['image-max-tokens'] ? Number(values['image-max-tokens']) : undefined,
    prompt: values.prompt,
  };
  if (!PROMPTS[options.prompt]) {
    throw new Error(
      `Unknown prompt ${options.prompt}, use one of ${Object.keys(PROMPTS).join(', ')}`,
    );
  }
  const pages = selectPages(
    values.dataset ? datasetPages(values.dataset) : samplePages(),
    values.samples?.split(','),
  );
  if (pages.length === 0) throw new Error('No samples found, run eval/samples/render.py first');
  const wanted = values.models?.split(',');
  const candidates = wanted
    ? wanted.map((id) => {
        const candidate = CANDIDATES.find((entry) => entry.id === id);
        if (!candidate) throw new Error(`Unknown model ${id}`);
        return candidate;
      })
    : CANDIDATES;
  const out =
    values.out ??
    join(evalDir, 'results', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'));
  await mkdir(out, { recursive: true });

  const runs: ModelRun[] = [];
  for (const candidate of candidates) {
    const file = join(out, `${candidate.id}.json`);
    if (existsSync(file)) {
      const previous: ModelRun = JSON.parse(await readFile(file, 'utf8'));
      runs.push(previous);
      continue;
    }
    const missing = [candidate.model, candidate.mmproj].filter(
      (model) => !existsSync(join(modelsDir(), model.name)),
    );
    if (missing.length > 0) {
      console.log(`${candidate.label}: skipped, run eval/download-models.ts first`);
      continue;
    }
    console.log(candidate.label);
    const run = await evaluate(candidate, pages, options);
    await writeFile(file, `${JSON.stringify(run, null, 2)}\n`);
    runs.push(run);
  }

  const summary = report(runs, pages, options);
  await writeFile(join(out, 'summary.md'), summary);
  console.log(`\n${summary}\nResults: ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
