import type { ErrorKind } from './sample.ts';
import type { ErrorResult } from './metrics.ts';

export interface PageResult {
  image: string;
  text: string;
  font: string;
  seconds: number;
  promptTokens: number;
  generatedTokens: number;
  charEdits: number;
  charCount: number;
  wordEdits: number;
  wordCount: number;
  errors: ErrorResult[];
  transcript: string;
  expectedWords?: number;
  transcribedWords?: number;
}

export interface ModelRun {
  id: string;
  label: string;
  license: string;
  bytes: number;
  threads: number;
  contextSize: number;
  imageMaxTokens?: number | undefined;
  prompt?: string;
  loadSeconds: number;
  peakRssBytes: number;
  pages: PageResult[];
  failure?: string;
}

export interface ModelSummary {
  id: string;
  label: string;
  license: string;
  gigabytes: number;
  peakRamGigabytes: number;
  loadSeconds: number;
  medianSecondsPerPage: number;
  cer: number;
  wer: number;
  preserved: number;
  corrected: number;
  wordCountError: number;
  wordCountMaxError: number;
  wordCountExact: number;
  pages: number;
  failure?: string;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? Number.NaN)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function share(errors: readonly ErrorResult[], outcome: ErrorResult['outcome']): number {
  return errors.length === 0
    ? Number.NaN
    : errors.filter((error) => error.outcome === outcome).length / errors.length;
}

export function wordCountErrors(pages: readonly PageResult[]): number[] {
  return pages.map((page) =>
    page.expectedWords === undefined || page.transcribedWords === undefined
      ? Number.NaN
      : Math.abs(page.transcribedWords - page.expectedWords) / Math.max(page.expectedWords, 1),
  );
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? Number.NaN : sum(values) / values.length;

export function summarize(run: ModelRun): ModelSummary {
  const errors = run.pages.flatMap((page) => page.errors);
  const wordErrors = wordCountErrors(run.pages);
  return {
    id: run.id,
    label: run.label,
    license: run.license,
    gigabytes: run.bytes / 1e9,
    peakRamGigabytes: run.peakRssBytes / 1e9,
    loadSeconds: run.loadSeconds,
    medianSecondsPerPage: median(run.pages.map((page) => page.seconds)),
    cer:
      sum(run.pages.map((page) => page.charEdits)) /
      Math.max(sum(run.pages.map((page) => page.charCount)), 1),
    wer:
      sum(run.pages.map((page) => page.wordEdits)) /
      Math.max(sum(run.pages.map((page) => page.wordCount)), 1),
    preserved: share(errors, 'preserved'),
    corrected: share(errors, 'corrected'),
    wordCountError: mean(wordErrors),
    wordCountMaxError: wordErrors.length === 0 ? Number.NaN : Math.max(...wordErrors),
    wordCountExact: mean(wordErrors.map((error) => (error === 0 ? 1 : 0))),
    pages: run.pages.length,
    failure: run.failure,
  };
}

const MISSING = 'n. v.';
const percent = (value: number) =>
  Number.isNaN(value) ? MISSING : `${(value * 100).toFixed(1)} %`;
const fixed = (value: number, digits = 1) =>
  Number.isNaN(value) ? MISSING : value.toFixed(digits);

const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

export function overviewTable(summaries: readonly ModelSummary[]): string {
  return table(
    [
      'Modell',
      'Seiten',
      'Dateien (GB)',
      'Peak-RAM (GB)',
      's/Seite (Median)',
      'Wortzahl-Abw. (Mittel)',
      'Wortzahl-Abw. (Max)',
      'Wortzahl exakt',
      'Fehler korrigiert',
      'Fehler erhalten',
      'CER',
      'WER',
      'Lizenz',
    ],
    summaries.map((summary) => [
      summary.failure ? `${summary.label} (abgebrochen)` : summary.label,
      String(summary.pages),
      fixed(summary.gigabytes, 2),
      fixed(summary.peakRamGigabytes, 2),
      fixed(summary.medianSecondsPerPage),
      percent(summary.wordCountError),
      percent(summary.wordCountMaxError),
      percent(summary.wordCountExact),
      percent(summary.corrected),
      percent(summary.preserved),
      percent(summary.cer),
      percent(summary.wer),
      summary.license,
    ]),
  );
}

export function cerByFontTable(runs: readonly ModelRun[]): string {
  const fonts = [...new Set(runs.flatMap((run) => run.pages.map((page) => page.font)))].toSorted();
  return table(
    ['Modell', ...fonts],
    runs.map((run) => [
      run.label,
      ...fonts.map((font) => {
        const pages = run.pages.filter((page) => page.font === font);
        if (pages.length === 0) return MISSING;
        return percent(
          sum(pages.map((page) => page.charEdits)) /
            Math.max(sum(pages.map((page) => page.charCount)), 1),
        );
      }),
    ]),
  );
}

const KIND_LABELS: Record<ErrorKind, string> = {
  R: 'Rechtschreibung',
  Z: 'Zeichensetzung',
  G: 'Grammatik',
};

export function preservationByKindTable(runs: readonly ModelRun[]): string {
  const kinds: ErrorKind[] = ['R', 'Z', 'G'];
  return table(
    ['Modell', ...kinds.map((kind) => KIND_LABELS[kind])],
    runs.map((run) => {
      const errors = run.pages.flatMap((page) => page.errors);
      return [
        run.label,
        ...kinds.map((kind) =>
          percent(
            share(
              errors.filter((error) => error.kind === kind),
              'preserved',
            ),
          ),
        ),
      ];
    }),
  );
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export function wordCountByPageTable(runs: readonly ModelRun[]): string {
  const images = [
    ...new Set(runs.flatMap((run) => run.pages.map((page) => page.image))),
  ].toSorted();
  const expected = (image: string) =>
    runs.flatMap((run) => run.pages).find((page) => page.image === image)?.expectedWords;
  return table(
    ['Seite', 'Wörter', ...runs.map((run) => run.label)],
    images.map((image) => [
      image.replace(/\.[^.]+$/, ''),
      expected(image)?.toString() ?? MISSING,
      ...runs.map((run) => {
        const page = run.pages.find((entry) => entry.image === image);
        return page?.expectedWords === undefined || page.transcribedWords === undefined
          ? MISSING
          : signed(page.transcribedWords - page.expectedWords);
      }),
    ]),
  );
}
