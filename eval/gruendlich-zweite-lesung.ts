import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEUTSCH } from '../src/annotations/profile.ts';
import type { Mark, Transcript } from '../src/annotations/transcript.ts';
import { correctPage } from '../src/correction/correct-page.ts';
import { confirmedWords } from '../src/correction/second-reading.ts';
import { readWords, separateUncertain } from '../src/correction/uncertain-reading.ts';
import type { WordReading } from '../src/correction/uncertain-reading.ts';
import { countWords } from '../src/stats/count-words.ts';
import { wilson } from './correct-report.ts';
import { installDom } from './dom.ts';
import { goldFromMarkup } from './gold.ts';
import { remapGold, scorePage } from './mark-metrics.ts';
import type { CorrectRun } from './ocr-correct.ts';
import { textMarkup } from './ocr-score.ts';
import type { OcrRun } from './ocr-run.ts';

export interface Rule {
  confirmedBelow: number;
  unconfirmedBelow: number;
}

export function parseRules(text: string): Rule[] {
  return text.split(',').map((pair) => {
    const [confirmed, unconfirmed] = pair.split('/').map(Number);
    return { confirmedBelow: confirmed ?? 0, unconfirmedBelow: unconfirmed ?? 0 };
  });
}

export function applyRule(
  lines: readonly (readonly WordReading[])[],
  confirmed: readonly boolean[],
  rule: Rule,
): WordReading[][] {
  let index = 0;
  return lines.map((words) =>
    words.map((word) => {
      const below = (confirmed[index] ?? false) ? rule.confirmedBelow : rule.unconfirmedBelow;
      index += 1;
      return { ...word, confidence: word.confidence < below ? 0 : 1 };
    }),
  );
}

interface Totals {
  pages: number;
  words: number;
  marks: number;
  hints: number;
  gold: number;
  matched: number;
  matchedWithHints: number;
}

const empty = (): Totals => ({
  pages: 0,
  words: 0,
  marks: 0,
  hints: 0,
  gold: 0,
  matched: 0,
  matchedWithHints: 0,
});

function withMarks(input: Transcript, marks: readonly { line: number; mark: Mark }[]): Transcript {
  return {
    lines: input.lines.map((line) => ({
      ...line,
      marks: marks.filter((entry) => entry.line === line.number).map((entry) => entry.mark),
    })),
  };
}

function load(files: readonly string[]): OcrRun['pages'] {
  return files.flatMap((file) => {
    const run: OcrRun = JSON.parse(readFileSync(file, 'utf8'));
    return run.pages;
  });
}

function rate(count: number, words: number): string {
  const [low, high] = wilson(count, words);
  return `${((100 * count) / words).toFixed(1)} (${(100 * low).toFixed(1)}–${(100 * high).toFixed(1)})`;
}

function percent(count: number, total: number): string {
  if (total === 0) return 'n. v.';
  const [low, high] = wilson(count, total);
  return `${Math.round((100 * count) / total)} % (${Math.round(100 * low)}–${Math.round(100 * high)})`;
}

async function main() {
  installDom();
  const { values } = parseArgs({
    options: {
      ocr: { type: 'string', multiple: true, default: [] },
      second: { type: 'string', multiple: true, default: [] },
      corrections: { type: 'string', multiple: true, default: [] },
      rules: { type: 'string', default: '0.95/0.95,0/0.95,0.95/1.01,0/1.01' },
    },
  });
  const pages = load(values.ocr);
  const seconds = load(values.second);
  const rules = parseRules(values.rules);
  const totals = new Map<string, Totals>();
  for (const file of values.corrections) {
    const run: CorrectRun = JSON.parse(readFileSync(file, 'utf8'));
    for (const doc of run.docs) {
      const rendered = doc.id.includes('--');
      const page = pages.find((entry) => entry.name === doc.id);
      const other = seconds.find((entry) => entry.name === doc.id);
      if (!doc.ok || !page || !other) continue;
      const result = await correctPage({
        lines: doc.lines,
        profile: DEUTSCH,
        corrector: { correct: async () => ({ ok: true, correctedText: doc.correctedText }) },
      });
      const words = readWords(page.content, page.tokens, doc.lines);
      if (!result.ok || !words) continue;
      const confirmed = confirmedWords(
        words.flat().map((word) => word.text),
        other.content.split(/\s+/u).filter(Boolean),
      );
      for (const rule of rules) {
        const key = `${rendered ? 'gerendert' : 'scads'}\t${rule.confirmedBelow} / ${rule.unconfirmedBelow}`;
        const sum = totals.get(key) ?? empty();
        totals.set(key, sum);
        const separated = separateUncertain(result.transcript, {
          lines: applyRule(words, confirmed, rule),
          uncertainBelow: 0.5,
        });
        const marks = separated.transcript.lines.flatMap((line) =>
          line.marks.map((mark) => ({ line: line.number, mark })),
        );
        const hints = separated.hints.map((hint) => ({ line: hint.line, mark: hint.mark }));
        sum.pages += 1;
        sum.words += countWords(doc.lines.join('\n'));
        sum.marks += marks.length;
        sum.hints += hints.length;
        if (rendered) {
          const input = withMarks(result.transcript, []);
          const { gold } = remapGold(goldFromMarkup(textMarkup(doc.id)).gold, input);
          sum.gold += scorePage(input, gold, input).gold;
          sum.matched += scorePage(input, gold, withMarks(input, marks)).matched;
          sum.matchedWithHints += scorePage(
            input,
            gold,
            withMarks(input, [...marks, ...hints]),
          ).matched;
        }
      }
    }
  }
  const out = [
    '| Seiten | Schwelle bestätigt / unbestätigt | Seitenzahl | Wörter | rote Marken je 100 Wörter | „unsicher gelesen“ je 100 Wörter | Recall rot | Recall mit Hinweisen |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const [key, sum] of totals) {
    const [name, rule] = key.split('\t');
    out.push(
      `| ${name} | ${rule} | ${sum.pages} | ${sum.words} | ${rate(sum.marks, sum.words)} | ${rate(sum.hints, sum.words)} | ${percent(sum.matched, sum.gold)} | ${percent(sum.matchedWithHints, sum.gold)} |`,
    );
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
