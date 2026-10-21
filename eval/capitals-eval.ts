import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEUTSCH } from '../src/annotations/profile.ts';
import type { Mark } from '../src/annotations/transcript.ts';
import { correctPage } from '../src/correction/correct-page.ts';
import { parseGold } from '../src/correction/gold.ts';
import { createLlmCorrector } from '../src/correction/llm-corrector.ts';
import type { LlmClient } from '../src/llm/client.ts';
import { correctorConfig } from '../src/llm/sidecar-corrector.ts';
import { countWords } from '../src/stats/count-words.ts';
import { scopeFromArgs } from './correct-prompts.ts';
import { installDom } from './dom.ts';
import { goldFromMarkup } from './gold.ts';
import { scorePage, sumScores } from './mark-metrics.ts';
import { corrector, localFile } from './ocr-registry.ts';
import { samplesDir } from './paths.ts';
import { PROFILE_SETS, summarize } from './profiles.ts';
import type { ProfileRun } from './profiles.ts';
import { launchServer, postJson, record } from './server.ts';

type Group = 'fehler' | 'fehlerfrei';

interface Doc {
  set: string;
  id: string;
  group: Group;
  markup: string;
}

interface Recording {
  model: string;
  answers: Record<string, { text: string; finishReason: string | null }>;
}

function readRecording(file: string): Recording {
  const json = record(JSON.parse(readFileSync(file, 'utf8')));
  const answers: Recording['answers'] = {};
  for (const [key, value] of Object.entries(record(json['answers']))) {
    const answer = record(value);
    answers[key] = {
      text: typeof answer['text'] === 'string' ? answer['text'] : '',
      finishReason: typeof answer['finishReason'] === 'string' ? answer['finishReason'] : null,
    };
  }
  return { model: typeof json['model'] === 'string' ? json['model'] : '', answers };
}

const SETS = ['capitals', 'de', 'gross-klein'] as const;

function readMarkup(dir: string, filter: (name: string) => boolean) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.txt') && filter(name))
    .toSorted()
    .map((name) => ({
      id: basename(name, '.txt'),
      markup: readFileSync(join(dir, name), 'utf8').trim(),
    }));
}

function docsOf(set: string): Doc[] {
  const files =
    set === 'capitals'
      ? readMarkup(samplesDir, (name) => name.startsWith('capitals-'))
      : readMarkup(join(samplesDir, 'profiles', PROFILE_SETS[set]?.dir ?? ''), () => true);
  return files.flatMap(({ id, markup }) => {
    const clean = parseGold(markup).corrected;
    const fehlerfrei = { set, id: `${id}-fehlerfrei`, group: 'fehlerfrei' as const, markup: clean };
    return clean === markup
      ? [fehlerfrei]
      : [{ set, id, group: 'fehler' as const, markup }, fehlerfrei];
  });
}

const keyOf = (request: unknown) =>
  createHash('sha256').update(JSON.stringify(request)).digest('hex');

async function runDoc(doc: Doc, client: Pick<LlmClient, 'complete'>, model: string) {
  const gold = goldFromMarkup(doc.markup);
  const lines = gold.input.lines.map((line) => line.text);
  const config = correctorConfig(corrector(model));
  const result = await correctPage({
    lines,
    profile: DEUTSCH,
    scope: scopeFromArgs('all', ''),
    corrector: createLlmCorrector({ client, config }),
  });
  const marks = result.ok
    ? result.transcript.lines.flatMap((line) =>
        line.marks.map((mark) => ({ ...mark, line: line.number })),
      )
    : [];
  return { doc, gold, lines, result, marks };
}

async function recordAnswers(out: string, model: string, sets: readonly string[]) {
  installDom();
  const info = corrector(model);
  const server = await launchServer({
    model: localFile(info.files.model),
    contextSize: info.server.contextSize,
    threads: 4,
    extraArgs: [...(info.server.cpuRepack ? [] : ['--no-repack']), '--reasoning', 'off'],
  });
  mkdirSync(dirname(out), { recursive: true });
  const recording = existsSync(out) ? readRecording(out) : { model, answers: {} };
  try {
    await server.ready(300_000);
    const client: Pick<LlmClient, 'complete'> = {
      async complete(request) {
        const known = recording.answers[keyOf(request)];
        if (known !== undefined) return known;
        const response = await postJson(server.port, '/v1/chat/completions', request);
        if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
        const json = record(JSON.parse(response.body));
        const choice = record(Array.isArray(json['choices']) ? json['choices'][0] : undefined);
        const content = record(choice['message'])['content'];
        const answer = {
          text: typeof content === 'string' ? content : '',
          finishReason:
            typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null,
        };
        recording.answers[keyOf(request)] = answer;
        return answer;
      },
    };
    for (const set of sets) {
      for (const doc of docsOf(set)) {
        await runDoc(doc, client, model);
        writeFileSync(out, `${JSON.stringify(recording)}\n`);
        console.log(`${set} ${doc.id}`);
      }
    }
  } finally {
    await server.stop();
  }
}

function isUpper(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase();
}

const lowersCapital = (mark: Mark) =>
  mark.kind === 'error' &&
  isUpper(mark.original.charAt(0)) &&
  mark.correction.charAt(0) === mark.original.charAt(0).toLowerCase();

type DocResult = Awaited<ReturnType<typeof runDoc>>;

function falseLowerings(run: DocResult) {
  const gold = run.gold.gold.lines.flatMap((line) =>
    line.marks.map((mark) => ({ ...mark, line: line.number })),
  );
  return run.marks.filter(
    (mark) =>
      lowersCapital(mark) &&
      !gold.some(
        (expected) =>
          expected.line === mark.line &&
          expected.offset < mark.offset + mark.original.length &&
          mark.offset < expected.offset + expected.original.length,
      ),
  );
}

function capitalsReport(runs: readonly DocResult[], verbose: boolean): string {
  const names = runs.filter((run) => run.doc.id.startsWith('capitals-namen'));
  const others = runs.filter((run) => !run.doc.id.startsWith('capitals-namen'));
  const errors = runs.filter((run) => run.doc.group === 'fehler');
  const score = sumScores(
    errors.map((run) =>
      scorePage(run.gold.input, run.gold.gold, run.result.ok ? run.result.transcript : undefined),
    ),
  );
  const count = (list: readonly DocResult[]) =>
    list.reduce((sum, run) => sum + falseLowerings(run).length, 0);
  const lines = [
    `capitals: ${runs.length} Seiten, ${runs.filter((run) => !run.result.ok).length} fehlgeschlagen`,
    `  falsche Kleinschreibungs-Marken: Namen-Texte ${count(names)}, Fehlertexte ${count(others)}`,
    `  echte Fehler ${score.gold}, getroffen (Art und Stelle) ${score.matched}, Marken ${score.predicted}`,
  ];
  if (verbose) {
    for (const run of runs) {
      for (const mark of falseLowerings(run)) {
        lines.push(`  falsch ${run.doc.id}: ${mark.original} -> ${mark.correction}`);
      }
    }
    for (const run of errors) {
      const found = new Set(run.marks.map((mark) => `${mark.original}->${mark.correction}`));
      const missed = run.gold.gold.lines
        .flatMap((line) => line.marks.map((mark) => `${mark.original}->${mark.correction}`))
        .filter((mark) => !found.has(mark));
      if (missed.length > 0) lines.push(`  verpasst ${run.doc.id}: ${missed.join(', ')}`);
    }
  }
  return lines.join('\n');
}

async function scoreAnswers(file: string, sets: readonly string[], verbose: boolean) {
  installDom();
  const recording = readRecording(file);
  const client: Pick<LlmClient, 'complete'> = {
    complete(request) {
      const answer = recording.answers[keyOf(request)];
      if (answer === undefined) throw new Error('Antwort fehlt in der Aufnahme');
      return Promise.resolve(answer);
    },
  };
  for (const set of sets) {
    const runs = [];
    for (const doc of docsOf(set)) runs.push(await runDoc(doc, client, recording.model));
    if (set === 'capitals') {
      console.log(capitalsReport(runs, verbose));
      continue;
    }
    const profileRun: ProfileRun = {
      set,
      profile: DEUTSCH.id,
      model: recording.model,
      variant: 'app',
      machine: 'Wiedergabe',
      threads: 0,
      peakRssBytes: 0,
      docs: runs.map((run) => ({
        id: run.doc.id,
        group: run.doc.group,
        words: countWords(run.lines.join('\n')),
        seconds: 0,
        ok: run.result.ok,
        droppedMarks: run.result.ok ? run.result.droppedMarks : 0,
        score: scorePage(
          run.gold.input,
          run.gold.gold,
          run.result.ok ? run.result.transcript : undefined,
        ),
        marks: run.marks,
        expected: run.gold.gold.lines.flatMap((line) =>
          line.marks.map((mark) => ({ ...mark, line: line.number })),
        ),
      })),
    };
    console.log(summarize(profileRun));
    if (verbose) {
      for (const run of runs) {
        for (const mark of run.marks) {
          console.log(`  ${run.doc.id}: ${mark.original} -> ${mark.correction} (${mark.type})`);
        }
      }
    }
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string', default: 'gemma-4-e2b-q4' },
      sets: { type: 'string', default: SETS.join(',') },
      verbose: { type: 'boolean', default: false },
    },
  });
  const [command, file] = positionals;
  const sets = values.sets.split(',');
  if (command === 'record' && file) await recordAnswers(file, values.model, sets);
  else if (command === 'score' && file) await scoreAnswers(file, sets, values.verbose);
  else throw new Error('Aufruf: capitals-eval.ts record|score <Datei> [--sets …] [--verbose]');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
