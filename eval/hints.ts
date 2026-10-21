import { readFileSync } from 'node:fs';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEUTSCH } from '../src/annotations/profile.ts';
import type { Mark, Transcript } from '../src/annotations/transcript.ts';
import { correctPage } from '../src/correction/correct-page.ts';
import { editDistance } from '../src/correction/edit-distance.ts';
import { readWords, separateUncertain } from '../src/correction/uncertain-reading.ts';
import { countWords } from '../src/stats/count-words.ts';
import { wilson } from './correct-report.ts';
import { installDom } from './dom.ts';
import { goldFromMarkup } from './gold.ts';
import { remapGold, scorePage } from './mark-metrics.ts';
import type { CorrectRun } from './ocr-correct.ts';
import { textMarkup } from './ocr-score.ts';
import type { OcrRun } from './ocr-run.ts';

interface Totals {
  pages: number;
  words: number;
  marks: number;
  hints: number;
  gold: number;
  matched: number;
  matchedWithHints: number;
  failed: number;
}

const empty = (): Totals => ({
  pages: 0,
  words: 0,
  marks: 0,
  hints: 0,
  gold: 0,
  matched: 0,
  matchedWithHints: 0,
  failed: 0,
});

function withMarks(input: Transcript, marks: readonly { line: number; mark: Mark }[]): Transcript {
  return {
    lines: input.lines.map((line) => ({
      ...line,
      marks: marks.filter((entry) => entry.line === line.number).map((entry) => entry.mark),
    })),
  };
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
      corrections: { type: 'string', multiple: true, default: [] },
      threshold: { type: 'string' },
      list: { type: 'boolean', default: false },
    },
  });
  const pages = values.ocr.flatMap((file) => {
    const run: OcrRun = JSON.parse(readFileSync(file, 'utf8'));
    return run.pages;
  });
  const totals = { scads: empty(), gerendert: empty() };
  for (const file of values.corrections) {
    const run: CorrectRun = JSON.parse(readFileSync(file, 'utf8'));
    for (const doc of run.docs) {
      const rendered = doc.id.includes('--');
      const sum = totals[rendered ? 'gerendert' : 'scads'];
      const page = pages.find((entry) => entry.name === doc.id);
      if (!doc.ok || !page) {
        sum.failed += 1;
        continue;
      }
      const result = await correctPage({
        lines: doc.lines,
        profile: DEUTSCH,
        corrector: { correct: async () => ({ ok: true, correctedText: doc.correctedText }) },
      });
      if (!result.ok) {
        sum.failed += 1;
        continue;
      }
      const words = readWords(page.content, page.tokens, doc.lines);
      const uncertainBelow = values.threshold ? Number(values.threshold) : 0.95;
      const separated = separateUncertain(
        result.transcript,
        words && { lines: words, uncertainBelow },
      );
      const marks = separated.transcript.lines.flatMap((line) =>
        line.marks.map((mark) => ({ line: line.number, mark })),
      );
      const hints = separated.hints.map((hint) => ({ line: hint.line, mark: hint.mark }));
      sum.pages += 1;
      sum.words += countWords(doc.lines.join('\n'));
      sum.marks += marks.length;
      sum.hints += hints.length;
      let goldOf: ((marks: { line: number; mark: Mark }[]) => number) | undefined;
      if (rendered) {
        const input = withMarks(result.transcript, []);
        const { gold } = remapGold(goldFromMarkup(textMarkup(doc.id)).gold, input);
        goldOf = (shown) => scorePage(input, gold, withMarks(input, shown)).matched;
        sum.gold += scorePage(input, gold, input).gold;
        sum.matched += goldOf(marks);
        sum.matchedWithHints += goldOf([...marks, ...hints]);
      }
      if (values.list) {
        for (const hint of separated.hints) {
          const { mark } = hint;
          const hit = goldOf ? goldOf([{ line: hint.line, mark }]) : 0;
          const fields = [
            doc.id,
            mark.type,
            hint.confidence.toFixed(2),
            mark.original.split(' ').length,
            mark.correction === '' ? 0 : mark.correction.split(' ').length,
            editDistance(mark.original.toLowerCase(), mark.correction.toLowerCase()),
            hit,
            `${mark.original} → ${mark.correction}`,
          ];
          console.log(fields.join('\t'));
        }
      }
    }
  }
  const out = [
    '| Seiten | Seitenzahl | Wörter | Marken je 100 Wörter | „unsicher gelesen“ je 100 Wörter | Recall | Recall mit Hinweisen | ungültig |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const [name, sum] of Object.entries(totals)) {
    if (sum.pages === 0) continue;
    out.push(
      `| ${name} | ${sum.pages} | ${sum.words} | ${rate(sum.marks, sum.words)} | ${rate(sum.hints, sum.words)} | ${percent(sum.matched, sum.gold)} | ${percent(sum.matchedWithHints, sum.gold)} | ${sum.failed} |`,
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
