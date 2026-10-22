import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEUTSCH, ENGLISCH, FRANZOESISCH, SACHFACH, SPANISCH } from '../src/annotations/profile.ts';
import type { CorrectionProfile } from '../src/annotations/profile.ts';
import type { Mark } from '../src/annotations/transcript.ts';
import { parseGold } from '../src/correction/gold.ts';
import { correctPage } from '../src/correction/correct-page.ts';
import { createLlmCorrector } from '../src/correction/llm-corrector.ts';
import type { Corrector } from '../src/correction/corrector.ts';
import type { LlmClient } from '../src/llm/client.ts';
import { correctorConfig } from '../src/llm/sidecar-corrector.ts';
import { installDom } from './dom.ts';
import { goldFromMarkup } from './gold.ts';
import { scorePage, sumScores } from './mark-metrics.ts';
import type { PageScore } from './mark-metrics.ts';
import { corrector, localFile } from './ocr-registry.ts';
import { samplesDir } from './paths.ts';
import { wilson } from './correct-report.ts';
import { scopeFromArgs } from './correct-prompts.ts';
import { launchServer, postJson, record } from './server.ts';
import { countWords } from '../src/stats/count-words.ts';

export const PROFILE_SETS: Record<string, { profile: CorrectionProfile; dir: string }> = {
  fr: { profile: FRANZOESISCH, dir: 'fr' },
  es: { profile: SPANISCH, dir: 'es' },
  sachfach: { profile: SACHFACH, dir: 'sachfach' },
  de: { profile: DEUTSCH, dir: '../texts' },
  'gross-klein': { profile: DEUTSCH, dir: 'gross-klein' },
  en: { profile: ENGLISCH, dir: 'en' },
};

export const SYSTEM_VARIANTS = ['app', 'plain'] as const;
type SystemVariant = (typeof SYSTEM_VARIANTS)[number];

const LANGUAGE_SENTENCES = [
  ' Der Text ist auf {language} geschrieben.',
  ' Beachte die Regeln der Sprache des Textes, auch Akzente und Satzzeichen. Fachwörter, Namen und Zitate bleiben unverändert.',
];

function withVariant(system: string | undefined, variant: SystemVariant): string | undefined {
  if (variant === 'app' || system === undefined) return system;
  return LANGUAGE_SENTENCES.reduce((text, sentence) => text.replace(sentence, ''), system);
}

interface DocRun {
  id: string;
  group: 'fehler' | 'fehlerfrei';
  words: number;
  seconds: number;
  ok: boolean;
  error?: string;
  droppedMarks: number;
  score: PageScore;
  marks: (Mark & { line: number })[];
  expected: (Mark & { line: number })[];
}

export interface ProfileRun {
  set: string;
  profile: string;
  model: string;
  variant: SystemVariant;
  passes?: number;
  temperature?: number;
  scope?: string;
  assignment?: boolean;
  machine: string;
  threads: number;
  peakRssBytes: number;
  docs: DocRun[];
}

export function repeated(inner: Corrector, passes: number): Corrector {
  return {
    async correct(lines, profile, signal, scope) {
      let result = await inner.correct(lines, profile, signal, scope);
      for (let pass = 1; pass < passes && result.ok; pass += 1) {
        const again = result.correctedText.split('\n');
        if (again.length !== lines.length) break;
        const next = await inner.correct(again, profile, signal, scope);
        if (!next.ok) break;
        result = next;
      }
      return result;
    },
  };
}

const stringOf = (value: unknown) => (typeof value === 'string' ? value : '');

async function main() {
  installDom();
  const { values } = parseArgs({
    options: {
      set: { type: 'string' },
      model: { type: 'string', default: 'gemma-4-e2b-q4' },
      variant: { type: 'string', default: 'app' },
      only: { type: 'string' },
      threads: { type: 'string', default: '4' },
      out: { type: 'string' },
      scope: { type: 'string', default: 'all' },
      assignment: { type: 'string', default: '' },
      passes: { type: 'string', default: '1' },
      temperature: { type: 'string' },
    },
  });
  const scope = scopeFromArgs(values.scope, values.assignment);
  const entry = PROFILE_SETS[values.set ?? ''];
  const variant = SYSTEM_VARIANTS.find((name) => name === values.variant);
  if (!entry || !variant || !values.out) {
    throw new Error(`--set (${Object.keys(PROFILE_SETS).join(', ')}), --variant, --out angeben`);
  }
  const model = corrector(values.model);
  const threads = Number(values.threads);
  const dir = join(samplesDir, 'profiles', entry.dir);
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .filter((name) => !values.only || values.only.split(',').includes(basename(name, '.txt')))
    .toSorted();

  const server = await launchServer({
    model: localFile(model.files.model),
    contextSize: model.server.contextSize,
    threads,
    extraArgs: [...(model.server.cpuRepack ? [] : ['--no-repack']), '--reasoning', 'off'],
  });
  const docs: DocRun[] = [];
  let peak = 0;
  try {
    await server.ready(300_000);
    const client: Pick<LlmClient, 'complete'> = {
      async complete(request) {
        const response = await postJson(server.port, '/v1/chat/completions', request);
        if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.body}`);
        const json = record(JSON.parse(response.body));
        const choice = record(Array.isArray(json['choices']) ? json['choices'][0] : undefined);
        if (process.env['PROFILES_DEBUG']) {
          console.log('ANSWER', JSON.stringify(record(choice['message'])['content']));
        }
        return {
          text: stringOf(record(choice['message'])['content']),
          finishReason:
            typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : null,
        };
      },
    };
    const base = correctorConfig(model);
    const system = withVariant(base.system, variant);
    const config = {
      ...base,
      ...(system !== undefined && { system }),
      ...(values.temperature !== undefined && { temperature: Number(values.temperature) }),
    };
    for (const name of names) {
      const markup = readFileSync(join(dir, name), 'utf8').trim();
      const marked = goldFromMarkup(markup);
      const clean = goldFromMarkup(parseGold(markup).corrected);
      const id = basename(name, '.txt');
      const inputs = [
        { id, group: 'fehler' as const, doc: marked },
        { id: `${id}-fehlerfrei`, group: 'fehlerfrei' as const, doc: clean },
      ];
      for (const { id: docId, group, doc } of inputs) {
        const lines = doc.input.lines.map((line) => line.text);
        const started = performance.now();
        const result = await correctPage({
          lines,
          profile: entry.profile,
          scope,
          corrector: repeated(createLlmCorrector({ client, config }), Number(values.passes)),
        });
        const seconds = (performance.now() - started) / 1000;
        const marks = result.ok
          ? result.transcript.lines.flatMap((line) =>
              line.marks.map((mark) => ({ ...mark, line: line.number })),
            )
          : [];
        docs.push({
          id: docId,
          group,
          words: countWords(lines.join('\n')),
          seconds,
          ok: result.ok,
          ...(result.ok ? {} : { error: JSON.stringify(result.error) }),
          droppedMarks: result.ok ? result.droppedMarks : 0,
          score: scorePage(doc.input, doc.gold, result.ok ? result.transcript : undefined),
          marks,
          expected: doc.gold.lines.flatMap((line) =>
            line.marks.map((mark) => ({ ...mark, line: line.number })),
          ),
        });
        console.log(
          `${entry.profile.id} ${docId} ${seconds.toFixed(1)} s ${result.ok ? 'ok' : 'fehler'}`,
        );
      }
    }
  } finally {
    peak = await server.stop();
  }
  const run: ProfileRun = {
    set: values.set ?? '',
    profile: entry.profile.id,
    model: model.id,
    variant,
    passes: Number(values.passes),
    ...(values.temperature !== undefined && { temperature: Number(values.temperature) }),
    scope: values.scope,
    assignment: scope.assignment !== '',
    machine: `${hostname()} (${cpus()[0]?.model.trim() ?? 'CPU'})`,
    threads,
    peakRssBytes: peak,
    docs,
  };
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(run)}\n`);
  console.log(summarize(run));
}

const pct = (part: number, whole: number) =>
  whole === 0 ? 'n. v.' : `${((part / whole) * 100).toFixed(1)} %`;

function interval(part: number, whole: number): string {
  const [low, high] = wilson(part, whole);
  return Number.isNaN(low)
    ? 'n. v.'
    : `${pct(part, whole)} (${(low * 100).toFixed(1)} bis ${(high * 100).toFixed(1)})`;
}

export function summarize(run: ProfileRun): string {
  const marked = run.docs.filter((doc) => doc.group === 'fehler');
  const clean = run.docs.filter((doc) => doc.group === 'fehlerfrei');
  const total = sumScores(marked.map((doc) => doc.score));
  const located = total.matched + total.wrongType;
  const cleanWords = clean.reduce((sum, doc) => sum + doc.words, 0);
  const cleanMarks = clean.reduce((sum, doc) => sum + doc.marks.length, 0);
  const failed = run.docs.filter((doc) => !doc.ok).length;
  const seconds = run.docs.reduce((sum, doc) => sum + doc.seconds, 0) / run.docs.length;
  const lines = [
    `${run.profile} (${run.model}, Prompt ${run.variant}, Umfang ${run.scope ?? 'all'}${run.assignment === true ? ' mit Aufgabenstellung' : ''}, ${run.threads} Threads)`,
    `Seiten ${run.docs.length}, fehlgeschlagen ${failed}, ${seconds.toFixed(1)} s je Seite, Peak-RAM ${(run.peakRssBytes / 1e9).toFixed(1)} GB`,
    `Soll-Fehler ${total.gold}, Marken ${total.predicted}`,
    `Recall (Art und Stelle) ${interval(total.matched, total.gold)}`,
    `Recall (nur Stelle) ${interval(located, total.gold)}`,
    `Precision (Art und Stelle) ${interval(total.matched, total.predicted)}`,
    `Precision (nur Stelle) ${interval(located, total.predicted)}`,
    `Korrektur richtig ${pct(total.fixCorrect, total.matched)}`,
    `Wortfehler vorher ${total.residualBefore}, nachher ${total.residualAfter}`,
    `Fehlalarme auf fehlerfreiem Text ${cleanMarks} Marken in ${cleanWords} Wörtern = ${((cleanMarks / cleanWords) * 100).toFixed(1)} je 100 Wörter`,
  ];
  const types = Object.entries(total.typeTotals).toSorted(([a], [b]) => a.localeCompare(b));
  for (const [type, counts] of types) {
    lines.push(
      `  ${type}: Soll ${counts.gold}, getroffen ${counts.matched}, nur Stelle ${counts.located}, gesetzt ${counts.predicted}`,
    );
  }
  return lines.join('\n');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
