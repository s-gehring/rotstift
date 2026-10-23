import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { wilson } from './correct-report.ts';
import { CONDITIONS, loadInputs } from './privacy-inputs.ts';
import type { Condition, WorkInput } from './privacy-inputs.ts';
import { leaks, scoreWork } from './privacy-metrics.ts';
import type { WorkScore } from './privacy-metrics.ts';
import { propagate } from './privacy-rules.ts';
import { cleanItems, locate } from './privacy-llm.ts';
import {
  IDENTIFIER_CATEGORIES,
  SENSITIVE_CATEGORIES,
  isIdentifier,
  isSensitive,
} from './privacy-sample.ts';
import { propagateSpans } from '../src/privacy/propagate.ts';
import type { PrivacySpan as AppSpan } from '../src/privacy/types.ts';
import type { PrivacySpan } from './privacy-sample.ts';
import type { PrivacyRun, RunItem } from './privacy-run.ts';

export interface DetectorSpec {
  name: string;
  files: string[];
  propagate: 'none' | 'exact' | 'fuzzy' | 'app';
  clean: boolean;
  sensitiveFrom?: string[];
}

export function parseSpec(text: string): DetectorSpec {
  const at = text.indexOf('=');
  const [files = '', ...options] = text.slice(at + 1).split(':');
  const sensitive = options.find((option) => option.startsWith('sens='))?.slice(5);
  return {
    name: text.slice(0, at),
    files: files.split('+'),
    propagate: options.includes('app')
      ? 'app'
      : options.includes('fuzzy')
        ? 'fuzzy'
        : options.includes('exact')
          ? 'exact'
          : 'none',
    clean: options.includes('post'),
    ...(sensitive ? { sensitiveFrom: sensitive.split('+') } : {}),
  };
}

function spansOf(item: RunItem | undefined, input: WorkInput, clean: boolean): PrivacySpan[] {
  if (!item) return [];
  if (!clean || !item.items) return item.spans;
  return locate(input.lines, cleanItems(item.items, input.context));
}

const GROUPS: Record<string, Condition[]> = {
  sauber: ['clean'],
  erkannt: ['ocr'],
  rauschen: ['noise1'],
};

interface Combined {
  input: WorkInput;
  spans: PrivacySpan[];
  seconds: number;
}

function propagateLikeApp(lines: readonly string[], spans: readonly PrivacySpan[]): PrivacySpan[] {
  const appSpans = spans.flatMap((span): AppSpan[] => {
    const { category } = span;
    if (span.kind === 'identifier' && isIdentifier(category))
      return [{ ...span, kind: 'identifier', category }];
    if (span.kind === 'sensitive' && isSensitive(category))
      return [{ ...span, kind: 'sensitive', category }];
    return [];
  });
  try {
    return (propagateSpans([{ lines, spans: appSpans }])[0] ?? []).map((span) => ({ ...span }));
  } catch {
    appCrashes++;
    const hyphenated = (span: AppSpan) =>
      (lines[span.line - 1] ?? '').slice(span.offset, span.offset + span.length).includes('-');
    const rest = propagateSpans([
      { lines, spans: appSpans.filter((span) => !hyphenated(span)) },
    ])[0];
    return [...(rest ?? []), ...appSpans.filter(hyphenated)].map((span) => ({ ...span }));
  }
}

let appCrashes = 0;

function find(run: PrivacyRun, input: WorkInput): RunItem | undefined {
  return run.items.find((item) => item.id === input.id && item.condition === input.condition);
}

function combine(spec: DetectorSpec, inputs: readonly WorkInput[]) {
  const runs: PrivacyRun[] = spec.files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const sensitiveRuns: PrivacyRun[] = (spec.sensitiveFrom ?? []).map((file) =>
    JSON.parse(readFileSync(file, 'utf8')),
  );
  const combined: Combined[] = inputs.flatMap((input) => {
    const items = runs.map((run) => find(run, input));
    if (items.some((item) => item === undefined)) return [];
    let spans = items.flatMap((item) => spansOf(item, input, spec.clean));
    if (spec.sensitiveFrom) {
      spans = [
        ...spans.filter((span) => span.kind === 'identifier'),
        ...sensitiveRuns.flatMap((run) =>
          spansOf(find(run, input), input, spec.clean).filter((span) => span.kind === 'sensitive'),
        ),
      ];
    }
    if (spec.propagate === 'app') spans = propagateLikeApp(input.lines, spans);
    else if (spec.propagate !== 'none') {
      spans = propagate(input.lines, spans, spec.propagate === 'fuzzy');
    }
    const seconds = [...items, ...sensitiveRuns.map((run) => find(run, input))].reduce(
      (sum, item) => sum + (item?.seconds ?? 0),
      0,
    );
    return [{ input, spans, seconds }];
  });
  const peak = Math.max(0, ...[...runs, ...sensitiveRuns].map((run) => run.peakRssBytes));
  return { combined, peak };
}

export interface Summary {
  works: number;
  leakFree: number;
  occurrences: number;
  found: number;
  byCategory: Record<string, [number, number]>;
  words: number;
  overWords: number;
  keep: number;
  keepReplaced: number;
  sensitive: number;
  sensitiveFound: number;
  sensitiveFalseAlarms: number;
  seconds: number;
}

export function summarize(scores: readonly WorkScore[], seconds: readonly number[]): Summary {
  const byCategory: Record<string, [number, number]> = {};
  for (const category of [...IDENTIFIER_CATEGORIES, ...SENSITIVE_CATEGORIES])
    byCategory[category] = [0, 0];
  for (const score of scores) {
    for (const occurrence of [...score.identifiers, ...score.sensitive]) {
      const entry = byCategory[occurrence.category] ?? [0, 0];
      entry[0] += occurrence.found ? 1 : 0;
      entry[1] += 1;
    }
  }
  const sum = (pick: (score: WorkScore) => number) =>
    scores.reduce((total, score) => total + pick(score), 0);
  return {
    works: scores.length,
    leakFree: scores.filter((score) => leaks(score) === 0).length,
    occurrences: sum((score) => score.identifiers.length),
    found: sum((score) => score.identifiers.filter((occurrence) => occurrence.found).length),
    byCategory,
    words: sum((score) => score.words),
    overWords: sum((score) => score.overWords.length),
    keep: sum((score) => score.keep.length),
    keepReplaced: sum((score) => score.keep.filter((entry) => entry.replaced).length),
    sensitive: sum((score) => score.sensitive.length),
    sensitiveFound: sum((score) => score.sensitive.filter((entry) => entry.found).length),
    sensitiveFalseAlarms: sum((score) => score.sensitiveFalseAlarms.length),
    seconds: seconds.reduce((total, value) => total + value, 0) / Math.max(1, seconds.length),
  };
}

const percent = (part: number, whole: number) =>
  whole === 0 ? '–' : `${((100 * part) / whole).toFixed(0)} %`;
const decimal = (value: number, digits = 1) => value.toFixed(digits).replace('.', ',');

function main() {
  const { values } = parseArgs({
    options: {
      detector: { type: 'string', multiple: true, default: [] },
      set: { type: 'string', default: 'dev' },
      categories: { type: 'boolean', default: false },
      examples: { type: 'string' },
    },
  });
  const specs = values.detector.map(parseSpec);
  const inputs = loadInputs(values.set, [...CONDITIONS]);
  const rows: string[] = [];
  const categoryRows: string[] = [];
  for (const spec of specs) {
    const { combined, peak } = combine(spec, inputs);
    for (const [group, conditions] of Object.entries(GROUPS)) {
      const subset = combined.filter((entry) => conditions.includes(entry.input.condition));
      if (subset.length === 0) continue;
      const scores = subset.map((entry) =>
        scoreWork(entry.input.lines, entry.input.gold, entry.spans),
      );
      const summary = summarize(
        scores,
        subset.map((entry) => entry.seconds),
      );
      const [low, high] = wilson(summary.leakFree, summary.works);
      rows.push(
        `| ${spec.name} | ${group} | ${summary.works} | **${percent(summary.leakFree, summary.works)}** (${percent(low * summary.works, summary.works)}–${percent(high * summary.works, summary.works)}) | ${percent(summary.found, summary.occurrences)} | ${decimal((100 * summary.overWords) / summary.words)} % | ${summary.keepReplaced}/${summary.keep} | ${percent(summary.sensitiveFound, summary.sensitive)} | ${decimal(summary.sensitiveFalseAlarms / summary.works, 2)} | ${decimal(summary.seconds)} s | ${decimal(peak / 1024 ** 3)} GB |`,
      );
      categoryRows.push(
        `| ${spec.name} | ${group} | ${IDENTIFIER_CATEGORIES.map((category) => {
          const [found, total] = summary.byCategory[category] ?? [0, 0];
          return `${percent(found, total)} (${total})`;
        }).join(' | ')} |`,
      );
      if (values.examples === spec.name) {
        for (const [index, score] of scores.entries()) {
          const entry = subset[index];
          const missed = score.identifiers.filter((occurrence) => !occurrence.found);
          if (
            missed.length +
              score.overWords.length +
              score.keep.filter((keep) => keep.replaced).length ===
            0
          )
            continue;
          console.log(
            `${entry?.input.id} ${entry?.input.condition}: verpasst ${missed.map((occurrence) => `${occurrence.text}/${occurrence.category}`).join(', ')} | zu viel ${score.overWords.join(', ')} | Figuren ${score.keep
              .filter((keep) => keep.replaced)
              .map((keep) => keep.text)
              .join(', ')}`,
          );
        }
      }
    }
  }
  console.log(
    '| Detektor | Text | Arbeiten | ohne Leck (95-%-KI) | Vorkommen gefunden | Überersetzung (Wörter) | Figuren ersetzt | sensibel gefunden | sensible Fehlalarme je Arbeit | Zeit je Arbeit | Peak-RSS |',
  );
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of rows) console.log(row);
  if (appCrashes > 0) console.log(`\npropagateSpans abgestürzt: ${appCrashes}×`);
  if (values.categories) {
    console.log(`\n| Detektor | Text | ${IDENTIFIER_CATEGORIES.join(' | ')} |`);
    console.log(`| --- | --- |${' ---: |'.repeat(IDENTIFIER_CATEGORIES.length)}`);
    for (const row of categoryRows) console.log(row);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  }
}
