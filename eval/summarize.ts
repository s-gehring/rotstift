import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { countWords } from '../src/stats/count-words.ts';
import { samplesDir } from './paths.ts';
import {
  cerByFontTable,
  overviewTable,
  preservationByKindTable,
  summarize,
  wordCountByPageTable,
} from './report.ts';
import type { ModelRun, PageResult } from './report.ts';
import { parseSample } from './sample.ts';

function groundTruth(page: PageResult): string | undefined {
  const file =
    page.font === 'scan'
      ? join(samplesDir, 'scans', `${page.text}.txt`)
      : join(samplesDir, 'texts', `${page.text}.txt`);
  return existsSync(file) ? parseSample(readFileSync(file, 'utf8').trim()).written : undefined;
}

function withWordCounts(page: PageResult): PageResult {
  if (page.expectedWords !== undefined) return page;
  const written = groundTruth(page);
  return written === undefined
    ? page
    : {
        ...page,
        expectedWords: countWords(written),
        transcribedWords: countWords(page.transcript),
      };
}

function variantLabel(run: ModelRun): string {
  const parts: string[] = [];
  if (run.imageMaxTokens) parts.push(`${run.imageMaxTokens} Bild-Token`);
  if (run.contextSize !== 8192) parts.push(`Kontext ${run.contextSize}`);
  if (run.prompt && run.prompt !== 'standard' && run.prompt !== 'model') {
    parts.push(`Prompt ${run.prompt}`);
  }
  return parts.length === 0 ? run.label : `${run.label}, ${parts.join(', ')}`;
}

function loadRuns(dirs: readonly string[]): ModelRun[] {
  return dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .toSorted()
      .map((name): ModelRun => {
        const run: ModelRun = JSON.parse(readFileSync(join(dir, name), 'utf8'));
        return { ...run, label: variantLabel(run), pages: run.pages.map(withWordCounts) };
      }),
  );
}

const runs = loadRuns(process.argv.slice(2));
console.log(
  [
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
  ].join('\n'),
);
