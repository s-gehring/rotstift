import { MISSING_KIND, parseReview, scoreReview, wordCount } from './content-form-review.ts';
import type { ReviewComment } from './content-form-review.ts';
import type { ReviewSample } from './content-form-sample.ts';

export interface ReviewDoc {
  readonly id: string;
  readonly output: string;
  readonly rawOutput?: string;
  readonly checklist?: string;
  readonly answers?: readonly unknown[];
  readonly checks?: readonly { readonly comment: string; readonly keep: boolean }[];
  readonly seconds: number;
  readonly promptTokens: number;
  readonly generatedTokens: number;
  readonly finishReason: string | null;
}

export interface ReviewRun {
  readonly label: string;
  readonly model: string;
  readonly variant: string;
  readonly temperature: number;
  readonly threads: number;
  readonly machine: string;
  readonly peakRssBytes: number;
  readonly runs: readonly { readonly seed: number; readonly docs: readonly ReviewDoc[] }[];
}

const percent = (part: number, whole: number) =>
  whole === 0 ? '–' : `${Math.round((100 * part) / whole)} %`;
const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const decimal = (value: number) => value.toFixed(1).replace('.', ',');

export interface RunFigures {
  readonly defects: number;
  readonly byComment: number;
  readonly withSummary: number;
  readonly kindAgrees: number;
  readonly unmatchedFlawed: number;
  readonly flawedDocs: number;
  readonly unmatchedClean: number;
  readonly cleanDocs: number;
  readonly cleanMax: number;
  readonly valid: number;
  readonly validWithoutKind: number;
  readonly docs: number;
  readonly comments: number;
  readonly longComments: number;
  readonly commentWords: number;
  readonly seconds: readonly number[];
}

export function figures(samples: readonly ReviewSample[], docs: readonly ReviewDoc[]): RunFigures {
  const totals = {
    defects: 0,
    byComment: 0,
    withSummary: 0,
    kindAgrees: 0,
    unmatchedFlawed: 0,
    flawedDocs: 0,
    unmatchedClean: 0,
    cleanDocs: 0,
    cleanMax: 0,
    valid: 0,
    validWithoutKind: 0,
    docs: 0,
    comments: 0,
    longComments: 0,
    commentWords: 0,
    seconds: [] as number[],
  };
  for (const doc of docs) {
    const sample = samples.find((entry) => entry.id === doc.id);
    if (!sample) continue;
    const review = parseReview(doc.output, sample.lines.length);
    const score = scoreReview(sample, review);
    totals.docs += 1;
    totals.seconds.push(doc.seconds);
    const stopped = doc.finishReason === 'stop';
    if (review.issues.length === 0 && stopped) totals.valid += 1;
    if (review.issues.every((issue) => issue === MISSING_KIND) && stopped) {
      totals.validWithoutKind += 1;
    }
    totals.comments += review.comments.length;
    totals.longComments += score.longComments;
    totals.commentWords += review.comments.reduce((sum, c) => sum + wordCount(c.text), 0);
    totals.defects += score.defects.length;
    totals.byComment += score.defects.filter((defect) => defect.byComment).length;
    totals.withSummary += score.defects.filter((d) => d.byComment || d.bySummary).length;
    totals.kindAgrees += score.defects.filter((defect) => defect.kindAgrees).length;
    if (sample.defects.length === 0) {
      totals.cleanDocs += 1;
      totals.unmatchedClean += score.unmatched.length;
      totals.cleanMax = Math.max(totals.cleanMax, score.unmatched.length);
    } else {
      totals.flawedDocs += 1;
      totals.unmatchedFlawed += score.unmatched.length;
    }
  }
  return totals;
}

export function summaryTable(
  samples: readonly ReviewSample[],
  results: readonly ReviewRun[],
): string {
  const rows = results.flatMap((result) =>
    result.runs.map((run, index) => {
      const f = figures(samples, run.docs);
      return [
        `${result.label} #${index + 1}`,
        `${percent(f.byComment, f.defects)} (${f.byComment}/${f.defects})`,
        percent(f.withSummary, f.defects),
        percent(f.kindAgrees, f.byComment),
        decimal(f.unmatchedFlawed / Math.max(1, f.flawedDocs)),
        `${decimal(f.unmatchedClean / Math.max(1, f.cleanDocs))} (max ${f.cleanMax})`,
        `${percent(f.valid, f.docs)} / ${percent(f.validWithoutKind, f.docs)}`,
        decimal(f.commentWords / Math.max(1, f.comments)),
        percent(f.longComments, f.comments),
        `${decimal(mean(f.seconds))} / ${decimal(Math.max(...f.seconds))}`,
      ];
    }),
  );
  const header = [
    'Lauf',
    'Treffer Rand',
    'Treffer mit Schluss',
    'Art richtig',
    'Unbelegt je Arbeit mit Mängeln',
    'Kommentare je saubere Arbeit',
    'Format gültig (streng / kind optional)',
    'Wörter je Kommentar',
    'Über 6 Wörter',
    's je Arbeit (Mittel / Max)',
  ];
  return [header, header.map(() => '---'), ...rows]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

const describe = (comment: ReviewComment, sample: ReviewSample) =>
  `  ${comment.line} ${comment.kind}: ${comment.text}   ⟵ ${sample.lines[comment.line - 1] ?? ''}`;

export function listing(samples: readonly ReviewSample[], docs: readonly ReviewDoc[]): string {
  return docs
    .map((doc) => {
      const sample = samples.find((entry) => entry.id === doc.id);
      if (!sample) return '';
      const review = parseReview(doc.output, sample.lines.length);
      const score = scoreReview(sample, review);
      return [
        `## ${doc.id} (${decimal(doc.seconds)} s)`,
        ...score.defects.map(
          (d) => `  [${d.byComment ? 'R' : ' '}${d.bySummary ? 'S' : ' '}] ${d.label}`,
        ),
        ...review.comments.map(
          (comment) =>
            `${score.unmatched.includes(comment) ? '?' : ' '}${describe(comment, sample)}`,
        ),
        `  Schluss: ${review.summary}`,
        ...review.issues.map((issue) => `  ! ${issue}`),
      ].join('\n');
    })
    .join('\n');
}
