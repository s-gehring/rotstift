import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Mark, Transcript } from '../src/annotations/transcript.ts';
import { parseGold } from '../src/correction/gold.ts';
import { goldFromMarkup } from './gold.ts';
import { scorePage } from './mark-metrics.ts';
import { samplesDir } from './paths.ts';
import { PROFILE_SETS, summarize } from './profiles.ts';
import type { ProfileRun } from './profiles.ts';

type LineMark = Mark & { line: number };
type Doc = ProfileRun['docs'][number];

const span = (mark: LineMark) =>
  [mark.offset, mark.offset + Math.max(mark.original.length, 1)] as const;

const overlaps = (a: LineMark, b: LineMark) => {
  if (a.line !== b.line) return false;
  const [aStart, aEnd] = span(a);
  const [bStart, bEnd] = span(b);
  return aStart < bEnd && bStart < aEnd;
};

export function combineMarks(runs: readonly LineMark[][], minVotes: number): LineMark[] {
  const kept: LineMark[] = [];
  for (const [index, marks] of runs.entries()) {
    for (const mark of marks) {
      if (kept.some((other) => overlaps(other, mark))) continue;
      const votes = runs.filter(
        (other, otherIndex) =>
          otherIndex === index || other.some((candidate) => overlaps(candidate, mark)),
      ).length;
      if (votes >= minVotes) kept.push(mark);
    }
  }
  return kept;
}

function sampleText(set: string, id: string): string {
  const name = id.replace(/-fehlerfrei$/, '');
  const dir = PROFILE_SETS[set]?.dir;
  if (dir === undefined) throw new Error(`unbekannte Probenmenge ${set}`);
  const markup = readFileSync(join(samplesDir, 'profiles', dir, `${name}.txt`), 'utf8').trim();
  return id.endsWith('-fehlerfrei') ? parseGold(markup).corrected : markup;
}

function rescore(set: string, doc: Doc, marks: LineMark[]): Doc {
  const { input, gold } = goldFromMarkup(sampleText(set, doc.id));
  const predicted: Transcript = {
    ...input,
    lines: input.lines.map((line) => ({
      ...line,
      marks: marks
        .filter((mark) => mark.line === line.number)
        .map(({ line: _line, ...mark }) => mark),
    })),
  };
  return { ...doc, marks, score: scorePage(input, gold, predicted) };
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { votes: { type: 'string', default: '1' }, out: { type: 'string' } },
  });
  const runs: ProfileRun[] = positionals.map((path) => JSON.parse(readFileSync(path, 'utf8')));
  const [first] = runs;
  if (!first || runs.length < 2) throw new Error('mindestens zwei Ergebnisdateien von profiles.ts');
  const minVotes = Number(values.votes);
  const docs = first.docs.map((doc) => {
    const perRun = runs.map((run) => run.docs.find((other) => other.id === doc.id)?.marks ?? []);
    return rescore(first.set, doc, combineMarks(perRun, minVotes));
  });
  const combined: ProfileRun = {
    ...first,
    model: `${runs.map((run) => run.model).join(' + ')} (mindestens ${minVotes})`,
    peakRssBytes: Math.max(...runs.map((run) => run.peakRssBytes)),
    docs: docs.map((doc) => ({
      ...doc,
      seconds: runs.reduce(
        (sum, run) => sum + (run.docs.find((other) => other.id === doc.id)?.seconds ?? 0),
        0,
      ),
    })),
  };
  if (values.out) writeFileSync(values.out, `${JSON.stringify(combined)}\n`);
  console.log(summarize(combined));
}

if (import.meta.main) main();
