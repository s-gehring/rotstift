import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { DEUTSCH } from '../src/annotations/profile.ts';
import type { Mark, Transcript } from '../src/annotations/transcript.ts';
import { deriveMarks } from '../src/correction/derive.ts';
import { splitTranscript } from '../src/pipeline/transcript-lines.ts';
import { countWords } from '../src/stats/count-words.ts';
import { wilson } from './correct-report.ts';
import { goldFromMarkup } from './gold.ts';
import type { CorrectedDoc, CorrectRun } from './ocr-correct.ts';
import { attributeMarks } from './ocr-attribution.ts';
import type { Cause } from './ocr-attribution.ts';
import {
  charProbabilities,
  lineProbabilities,
  markConfidence,
} from '../src/correction/reading-confidence.ts';
import { openDictionary } from './ocr-dictionary.ts';
import type { Dictionary } from './ocr-dictionary.ts';
import { judgeMark, wordsOf } from './ocr-guards.ts';
import type { Guards, Verdict } from './ocr-guards.ts';
import type { OcrRun } from './ocr-run.ts';
import { TRUTH_SLIPS } from './ocr-truth-slips.ts';
import { characterEdits } from './metrics.ts';
import { remapGold, scorePage } from './mark-metrics.ts';
import { samplesDir } from './paths.ts';

export interface JudgedMark {
  line: number;
  mark: Mark;
  verdict: Verdict;
}

export function normalizeLine(line: string): string {
  return line.replaceAll(/\s+/gu, ' ').trim();
}

export function judgeDoc(
  doc: CorrectedDoc,
  guards: Guards,
  probabilities?: readonly (readonly number[])[],
): JudgedMark[] {
  const lines = doc.lines.map(normalizeLine);
  return deriveMarks(lines, doc.correctedText, { profile: DEUTSCH }).flatMap((line, index) =>
    line.marks.map((mark) => ({
      line: index,
      mark,
      verdict: judgeMark(mark, { line: line.text, probabilities: probabilities?.[index] }, guards),
    })),
  );
}

export function docProbabilities(
  page: OcrRun['pages'][number] | undefined,
  lines: readonly string[],
) {
  if (!page) return undefined;
  const chars = charProbabilities(page.content, page.tokens);
  return chars ? lineProbabilities(page.content, chars, lines.map(normalizeLine)) : undefined;
}

function rate(count: number, words: number): string {
  const [low, high] = wilson(count, words);
  const value = (100 * count) / words;
  return `${value.toFixed(2)} (${(100 * low).toFixed(2)}–${(100 * high).toFixed(2)})`;
}

function percent(count: number, total: number, digits = 0): string {
  const [low, high] = wilson(count, total);
  const format = (value: number) => (100 * value).toFixed(digits);
  return `${format(count / total)} % (${format(low)}–${format(high)})`;
}

interface FalseAlarmTotals {
  words: number;
  reading: number;
  corrector: number;
  uncertainReading: number;
  uncertainCorrector: number;
  dropped: number;
  failed: number;
  truth: number;
}

function readOcr(file: string): OcrRun {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readCorrections(file: string): CorrectRun {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function falseAlarms(
  run: CorrectRun,
  ocr: OcrRun | undefined,
  dataset: string,
  guards: Guards,
): FalseAlarmTotals {
  const totals: FalseAlarmTotals = {
    words: 0,
    reading: 0,
    corrector: 0,
    uncertainReading: 0,
    uncertainCorrector: 0,
    dropped: 0,
    failed: 0,
    truth: 0,
  };
  for (const doc of run.docs) {
    const truth = splitTranscript(
      readFileSync(join(dataset, 'ground_truth', `${doc.id}.txt`), 'utf8'),
    );
    if (!doc.ok) {
      totals.failed += 1;
      continue;
    }
    totals.words += countWords(truth.join('\n'));
    const lines = doc.lines.map(normalizeLine);
    const attribution = attributeMarks(truth.map(normalizeLine), lines);
    const page = ocr?.pages.find((entry) => entry.name === doc.id);
    for (const judged of judgeDoc(doc, guards, docProbabilities(page, doc.lines))) {
      const cause: Cause = attribution.cause(judged.line, judged.mark);
      const slips = TRUTH_SLIPS[doc.id] ?? [];
      if (attribution.truthAround(judged.line, judged.mark).some((word) => slips.includes(word))) {
        totals.truth += 1;
      } else if (judged.verdict === 'drop') totals.dropped += 1;
      else if (judged.verdict === 'uncertain') {
        if (cause === 'reading') totals.uncertainReading += 1;
        else totals.uncertainCorrector += 1;
      } else if (cause === 'reading') totals.reading += 1;
      else totals.corrector += 1;
    }
  }
  return totals;
}

export function recallDocs(run: CorrectRun, ocr: OcrRun | undefined, guards: Guards) {
  const score = {
    total: 0,
    gold: 0,
    matched: 0,
    predicted: 0,
    uncertain: 0,
    words: 0,
    cleanWords: 0,
    cleanAlarms: 0,
    cleanUncertain: 0,
    failed: 0,
  };
  for (const doc of run.docs) {
    if (!doc.ok) {
      score.failed += 1;
      continue;
    }
    const lines = doc.lines.map(normalizeLine);
    const page = ocr?.pages.find((entry) => entry.name === doc.id);
    const judged = judgeDoc(doc, guards, docProbabilities(page, doc.lines));
    const uncertain = judged.filter((entry) => entry.verdict === 'uncertain').length;
    const kept = judged.filter((entry) => entry.verdict === 'keep');
    const words = countWords(lines.join('\n'));
    if (doc.id.includes('--fehlerfrei')) {
      score.cleanWords += words;
      score.cleanAlarms += kept.length;
      score.cleanUncertain += uncertain;
      continue;
    }
    const text = doc.id.split('--')[0] ?? '';
    const markup = readFileSync(join(samplesDir, 'texts', `${text}.txt`), 'utf8').trim();
    const input: Transcript = {
      lines: lines.map((line, index) => ({ number: index + 1, text: line, marks: [] })),
    };
    const mapped = remapGold(goldFromMarkup(markup).gold, input);
    const predicted: Transcript = {
      lines: input.lines.map((line, index) => ({
        ...line,
        marks: kept.filter((entry) => entry.line === index).map((entry) => entry.mark),
      })),
    };
    const pageScore = scorePage(input, mapped.gold, predicted);
    score.total += mapped.total;
    score.gold += pageScore.gold;
    score.matched += pageScore.matched;
    score.predicted += pageScore.predicted;
    score.uncertain += uncertain;
    score.words += words;
  }
  return score;
}

function writtenLines(name: string): string[] {
  const text = name.split('--')[0] ?? '';
  const markup = readFileSync(join(samplesDir, 'texts', `${text}.txt`), 'utf8').trim();
  return goldFromMarkup(markup).input.lines.map((line) => line.text);
}

export function readingErrorRate(ocr: OcrRun, dataset: string) {
  let edits = 0;
  let chars = 0;
  let words = 0;
  let misread = 0;
  for (const page of ocr.pages.filter((entry) => entry.finishReason === 'stop')) {
    const truth = (
      page.name.includes('--')
        ? writtenLines(page.name)
        : splitTranscript(readFileSync(join(dataset, 'ground_truth', `${page.name}.txt`), 'utf8'))
    )
      .map(normalizeLine)
      .join(' ');
    const read = splitTranscript(page.content).map(normalizeLine).join(' ');
    const count = characterEdits(truth, read);
    edits += count.edits;
    chars += count.total;
    const attribution = attributeMarks([truth], [read]);
    words += attribution.readWords;
    misread += attribution.misreadWords;
  }
  const incomplete = ocr.pages.filter((entry) => entry.finishReason !== 'stop').length;
  return { edits, chars, words, misread, incomplete };
}

async function guardSet(dictionary: Dictionary | undefined, thresholds: readonly number[]) {
  const sets: { name: string; guards: Guards }[] = [{ name: 'ohne', guards: {} }];
  if (dictionary) {
    sets.push({ name: 'Wörterbuch', guards: { isWord: (word) => dictionary.isWord(word) } });
  }
  for (const minConfidence of thresholds) {
    sets.push({ name: `Lesesicherheit < ${minConfidence}`, guards: { minConfidence } });
    if (dictionary) {
      sets.push({
        name: `Wörterbuch + Lesesicherheit < ${minConfidence}`,
        guards: { minConfidence, isWord: (word) => dictionary.isWord(word) },
      });
    }
  }
  return sets;
}

function correctionWords(runs: readonly CorrectRun[]): string[] {
  return runs.flatMap((run) =>
    run.docs.flatMap((doc) =>
      deriveMarks(doc.lines.map(normalizeLine), doc.correctedText, { profile: DEUTSCH }).flatMap(
        (line) => line.marks.flatMap((mark) => wordsOf(mark.correction)),
      ),
    ),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string' },
      ocr: { type: 'string', multiple: true, default: [] },
      scads: { type: 'string', multiple: true, default: [] },
      recall: { type: 'string', multiple: true, default: [] },
      'recall-ocr': { type: 'string' },
      dictionary: { type: 'string' },
      hunspell: { type: 'string' },
      thresholds: { type: 'string', default: '0.5,0.7,0.8,0.9,0.95' },
      curve: { type: 'string', multiple: true, default: [] },
      examples: { type: 'string' },
      'curve-thresholds': {
        type: 'string',
        default: '0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.85,0.9,0.95,0.98',
      },
    },
  });
  const dataset = values.dataset ?? '';
  const recallOcr = values['recall-ocr'] ? readOcr(values['recall-ocr']) : undefined;
  const ocrRuns = [...values.ocr.map((file) => readOcr(file)), ...(recallOcr ? [recallOcr] : [])];
  const ocrFor = (model: string) =>
    ocrRuns.find((run) => run.model === model && !run.pages[0]?.name.includes('--'));
  const scadsRuns = values.scads.map((file) => ({ file, run: readCorrections(file) }));
  const recallRuns = values.recall.map((file) => ({ file, run: readCorrections(file) }));
  const dictionary = values.dictionary
    ? await openDictionary(values.dictionary, values.hunspell)
    : undefined;
  if (dictionary) {
    await dictionary.learn(correctionWords([...scadsRuns, ...recallRuns].map(({ run }) => run)));
    await dictionary.save();
  }
  const thresholds = values.thresholds.split(',').map(Number);
  const sets = await guardSet(dictionary, thresholds);
  const out: string[] = [];

  for (const ocr of ocrRuns) {
    const errors = readingErrorRate(ocr, dataset);
    out.push(
      `Lesefehler ${ocr.model}: CER ${percent(errors.edits, errors.chars, 1)}, falsch gelesene Wörter ${percent(errors.misread, errors.words, 1)} (${errors.misread} von ${errors.words}), ${ocr.pages.length} Seiten, davon ${errors.incomplete} unvollständig (Wiederholung bis zum Token-Limit, nicht gewertet), Mittel ${(ocr.pages.reduce((sum, page) => sum + page.seconds, 0) / ocr.pages.length).toFixed(1)} s/Seite auf ${ocr.machine}, ${ocr.threads} Threads`,
      '',
    );
  }

  for (const { file, run } of scadsRuns) {
    const ocr = ocrFor(file.includes('qwen') ? 'qwen3-vl-4b-q4' : 'glm-ocr-q8');
    const source = file.includes('truth') ? undefined : ocr;
    out.push(`### ${file.split('/').at(-1)} (${run.prompt}, ${run.docs.length} Seiten)`, '');
    out.push(
      '| Gegenmittel | Fehlalarme je 100 Wörter | davon Lesefehler | davon Korrektor | „unsicher gelesen“ | verworfen | Vorlage fehlerhaft | ungültig |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const { name, guards } of sets) {
      if (guards.minConfidence !== undefined && !source) continue;
      const totals = falseAlarms(run, source, dataset, guards);
      out.push(
        `| ${name} | ${rate(totals.reading + totals.corrector, totals.words)} | ${totals.reading} | ${totals.corrector} | ${totals.uncertainReading + totals.uncertainCorrector} (${totals.uncertainReading} Lesefehler) | ${totals.dropped} | ${totals.truth} | ${totals.failed} |`,
      );
    }
    out.push('');
  }

  for (const { file, run } of recallRuns) {
    const source = file.includes('rendered') ? recallOcr : undefined;
    out.push(`### ${file.split('/').at(-1)} (${run.prompt}, ${run.docs.length} Texte)`, '');
    out.push(
      '| Gegenmittel | Recall | Precision | erreichbare Fehler | Hinweise je 100 Wörter | Fehlalarme je 100 Wörter fehlerfrei | Hinweise fehlerfrei | ungültig |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const { name, guards } of sets) {
      if (guards.minConfidence !== undefined && !source) continue;
      const score = recallDocs(run, source, guards);
      const clean = score.cleanWords > 0 ? rate(score.cleanAlarms, score.cleanWords) : 'n. v.';
      out.push(
        `| ${name} | ${percent(score.matched, score.gold)} | ${percent(score.matched, score.predicted)} | ${score.gold} von ${score.total} | ${((100 * score.uncertain) / score.words).toFixed(1)} | ${clean} | ${score.cleanUncertain} | ${score.failed} |`,
      );
    }
    out.push('');
  }
  if (values.examples) {
    const run = readCorrections(values.examples);
    const ocr =
      run.docs.length > 0
        ? ocrFor(values.examples.includes('qwen') ? 'qwen3-vl-4b-q4' : 'glm-ocr-q8')
        : undefined;
    for (const doc of run.docs.filter((entry) => entry.ok)) {
      const truthFile = join(dataset, 'ground_truth', `${doc.id}.txt`);
      const truth = splitTranscript(readFileSync(truthFile, 'utf8')).map(normalizeLine);
      const attribution = attributeMarks(truth, doc.lines.map(normalizeLine));
      const probabilities = values.examples.includes('truth')
        ? undefined
        : docProbabilities(
            ocr?.pages.find((entry) => entry.name === doc.id),
            doc.lines,
          );
      for (const judged of judgeDoc(doc, {}, probabilities)) {
        const line = normalizeLine(doc.lines[judged.line] ?? '');
        const confidence = probabilities?.[judged.line]
          ? markConfidence(line, probabilities[judged.line] ?? [], judged.mark).toFixed(2)
          : '-';
        out.push(
          `${doc.id}\t${attribution.cause(judged.line, judged.mark)}\t${confidence}\t${judged.mark.type}\t${judged.mark.original} → ${judged.mark.correction}`,
        );
      }
    }
  }
  for (const pair of values.curve) {
    const [scadsFile = '', renderedFile = ''] = pair.split(',');
    const scads = readCorrections(scadsFile);
    const rendered = readCorrections(renderedFile);
    const ocr = ocrFor(scadsFile.includes('qwen') ? 'qwen3-vl-4b-q4' : 'glm-ocr-q8');
    out.push(`### Kurve ${scadsFile.split('/').at(-1)} / ${renderedFile.split('/').at(-1)}`, '');
    out.push(
      '| Schwelle | Wörterbuch | Fehlalarme je 100 Wörter (ScaDS) | Hinweise je 100 Wörter (ScaDS) | Recall (gerendert) | Hinweise je 100 Wörter (gerendert) |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const threshold of values['curve-thresholds'].split(',').map(Number)) {
      for (const isWord of dictionary
        ? [undefined, (word: string) => dictionary.isWord(word)]
        : [undefined]) {
        const guards: Guards = { minConfidence: threshold, ...(isWord && { isWord }) };
        const alarms = falseAlarms(scads, ocr, dataset, guards);
        const recall = recallDocs(rendered, recallOcr, guards);
        out.push(
          `| ${threshold} | ${isWord ? 'ja' : 'nein'} | ${rate(alarms.reading + alarms.corrector, alarms.words)} | ${((100 * (alarms.uncertainReading + alarms.uncertainCorrector)) / alarms.words).toFixed(1)} | ${percent(recall.matched, recall.gold)} | ${((100 * recall.uncertain) / recall.words).toFixed(1)} |`,
        );
      }
    }
    out.push('');
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
