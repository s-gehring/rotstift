import { median, percent, fixed, table } from './report.ts';
import type { Mark } from '../src/annotations/transcript.ts';
import { sumScores } from './mark-metrics.ts';
import type { PageScore } from './mark-metrics.ts';

export type Group = 'fehler' | 'fehlerfrei' | 'scads' | 'ocr';

export interface DocResult {
  id: string;
  group: Group;
  words: number;
  lines: number;
  seconds: number;
  promptTokens: number;
  generatedTokens: number;
  firstAccepted: boolean;
  accepted: boolean;
  issues: string[];
  output: string;
  preservedLines: number;
  score: PageScore;
  marks: (Mark & { line: number })[];
  unlocated?: number;
  recoverable?: number;
  total?: number;
}

export interface CorrectorRun {
  id: string;
  label: string;
  license: string;
  bytes: number;
  threads: number;
  contextSize: number;
  prompt: string;
  loadSeconds: number;
  peakRssBytes: number;
  docs: DocResult[];
  failure?: string;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const ratio = (part: number, whole: number) => (whole === 0 ? Number.NaN : part / whole);

export interface CorrectorSummary {
  label: string;
  license: string;
  gigabytes: number;
  peakRamGigabytes: number;
  medianSeconds: number;
  parseFirst: number;
  parseFinal: number;
  precision: number;
  recall: number;
  strictRecall: number;
  fixRate: number;
  wrongType: number;
  falseAlarmsClean: number;
  falseAlarmsScads: number;
  preserved: number;
  residual: number;
  failure: string | undefined;
}

function inGroup(run: CorrectorRun, ...groups: Group[]): DocResult[] {
  return run.docs.filter((doc) => groups.includes(doc.group));
}

function alarms(docs: readonly DocResult[]): number {
  return (
    (sum(docs.map((doc) => doc.score.predicted)) / Math.max(sum(docs.map((doc) => doc.words)), 1)) *
    100
  );
}

export function summarizeCorrector(run: CorrectorRun): CorrectorSummary {
  const marked = inGroup(run, 'fehler', 'ocr');
  const total = sumScores(marked.map((doc) => doc.score));
  const clean = inGroup(run, 'fehlerfrei');
  const scads = inGroup(run, 'scads');
  const scored = inGroup(run, 'fehler', 'fehlerfrei', 'scads', 'ocr');
  return {
    label: run.label,
    license: run.license,
    gigabytes: run.bytes / 1e9,
    peakRamGigabytes: run.peakRssBytes / 1e9,
    medianSeconds: median(scored.map((doc) => doc.seconds)),
    parseFirst: ratio(scored.filter((doc) => doc.firstAccepted).length, scored.length),
    parseFinal: ratio(scored.filter((doc) => doc.accepted).length, scored.length),
    precision: ratio(total.matched, total.predicted),
    recall: ratio(total.matched, total.gold),
    strictRecall: ratio(total.strict, total.gold),
    fixRate: ratio(total.fixCorrect, total.matched),
    wrongType: ratio(total.wrongType, total.gold),
    falseAlarmsClean: clean.length === 0 ? Number.NaN : alarms(clean),
    falseAlarmsScads: scads.length === 0 ? Number.NaN : alarms(scads),
    preserved: ratio(
      sum(scored.map((doc) => doc.preservedLines)),
      sum(scored.map((doc) => doc.lines)),
    ),
    residual: ratio(total.residualAfter, total.residualBefore),
    failure: run.failure,
  };
}

export function correctorOverviewTable(summaries: readonly CorrectorSummary[]): string {
  return table(
    [
      'Modell',
      'Dateien (GB)',
      'Peak-RAM (GB)',
      's/Seite (Median)',
      'Antwort gültig (1. Versuch)',
      'Antwort gültig (mit Reparatur)',
      'Recall',
      'Precision',
      'Korrektur richtig',
      'Fehlalarme / 100 Wörter',
      'Text erhalten',
      'Lizenz',
    ],
    summaries.map((summary) => [
      summary.failure ? `${summary.label} (abgebrochen)` : summary.label,
      fixed(summary.gigabytes, 2),
      fixed(summary.peakRamGigabytes, 2),
      fixed(summary.medianSeconds),
      percent(summary.parseFirst),
      percent(summary.parseFinal),
      percent(summary.recall),
      percent(summary.precision),
      percent(summary.fixRate),
      `${fixed(summary.falseAlarmsClean)} / ${fixed(summary.falseAlarmsScads)}`,
      percent(summary.preserved),
      summary.license,
    ]),
  );
}

export function marksByTypeTable(runs: readonly CorrectorRun[]): string {
  const types = ['R', 'Z', 'G'];
  return table(
    ['Modell', ...types.map((type) => `Recall ${type}`), 'Strenger Recall', 'Falscher Typ'],
    runs.map((run) => {
      const total = sumScores(inGroup(run, 'fehler', 'ocr').map((doc) => doc.score));
      return [
        run.label,
        ...types.map((type) => {
          const counts = total.typeTotals[type];
          return counts ? percent(ratio(counts.matched, counts.gold)) : 'n. v.';
        }),
        percent(ratio(total.strict, total.gold)),
        percent(ratio(total.wrongType, total.gold)),
      ];
    }),
  );
}

export function residualTable(runs: readonly CorrectorRun[]): string {
  return table(
    ['Modell', 'Wortfehler vorher', 'nach Anwenden der Markierungen'],
    runs.map((run) => {
      const total = sumScores(inGroup(run, 'fehler', 'ocr').map((doc) => doc.score));
      return [run.label, String(total.residualBefore), String(total.residualAfter)];
    }),
  );
}

export function textsTable(runs: readonly CorrectorRun[], groups: Group[]): string {
  const ids = [...new Set(runs.flatMap((run) => inGroup(run, ...groups).map((doc) => doc.id)))];
  return table(
    ['Text', ...runs.map((run) => run.label)],
    ids.map((id) => [
      id,
      ...runs.map((run) => {
        const doc = run.docs.find((entry) => entry.id === id);
        if (!doc) return 'n. v.';
        const flag = doc.accepted ? '' : ' (abgelehnt)';
        return `${doc.score.matched}/${doc.score.gold} richtig, ${doc.score.predicted - doc.score.matched} falsch${flag}`;
      }),
    ]),
  );
}

export function correctorReport(runs: readonly CorrectorRun[], heading: string): string {
  const ocr = runs.some((run) => run.docs.some((doc) => doc.group === 'ocr'));
  return [
    heading,
    '',
    correctorOverviewTable(runs.map(summarizeCorrector)),
    '',
    'Recall je Fehlerart:',
    '',
    marksByTypeTable(runs),
    '',
    'Wortfehler gegenüber dem korrigierten Text:',
    '',
    residualTable(runs),
    '',
    'Treffer je Text mit Fehlern:',
    '',
    textsTable(runs, ['fehler']),
    '',
    ...(ocr ? ['Treffer je OCR-Seite:', '', textsTable(runs, ['ocr']), ''] : []),
  ].join('\n');
}
