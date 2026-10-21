import { openHints } from '../correction/uncertain-reading.ts';
import type { PageEntry } from '../pipeline/runner.ts';
import { describeError } from '../pipeline/transcriber.ts';
import { buildResults } from '../results/summary.ts';
import type { ReviewState } from '../review/review-flow.ts';
import { summarizeArbeit } from '../review/summary.ts';
import type { Arbeit } from './arbeiten.ts';
import type { ImportPage } from './pages.ts';

export type Entries = Readonly<Record<string, PageEntry>>;

export type Activity = 'waiting' | 'recognizing' | 'correcting';

export interface Figure {
  readonly value: number;
  readonly partial: boolean;
}

export interface PageProblem {
  readonly page: ImportPage;
  readonly position: number;
  readonly source: 'review' | 'count';
  readonly text: string;
}

export interface ArbeitStatus {
  readonly hasResults: boolean;
  readonly words: Figure | null;
  readonly errors: Figure | null;
  readonly uncertain: number;
  readonly activity: Activity | null;
  readonly problems: readonly PageProblem[];
}

const FALLBACK_PROBLEM = 'Die Seite konnte nicht erkannt werden.';

function activityOf(arbeit: Arbeit, entries: Entries, review: ReviewState): Activity | null {
  const found = new Set<Activity>();
  for (const page of arbeit.pages) {
    const reviewed = review.pages[page.id];
    if (review.run !== null && reviewed !== undefined) {
      if (reviewed.status === 'transcribing') found.add('recognizing');
      else if (reviewed.status === 'locating' || reviewed.status === 'correcting') {
        found.add('correcting');
      } else if (reviewed.status === 'waiting') found.add('waiting');
      continue;
    }
    const status = entries[page.id]?.status;
    if (status === 'running') found.add('recognizing');
    else if (status === 'waiting') found.add('waiting');
  }
  return (
    (['recognizing', 'correcting', 'waiting'] as const).find((kind) => found.has(kind)) ?? null
  );
}

function problemsOf(arbeit: Arbeit, entries: Entries, review: ReviewState): PageProblem[] {
  return arbeit.pages.flatMap((page, index): PageProblem[] => {
    const position = index + 1;
    const reviewed = review.pages[page.id];
    if (reviewed !== undefined) {
      return reviewed.status === 'unreadable' || reviewed.status === 'failed'
        ? [{ page, position, source: 'review', text: reviewed.message ?? FALLBACK_PROBLEM }]
        : [];
    }
    const entry = entries[page.id];
    if (entry?.status !== 'error' || entry.hasTranscript || entry.error?.kind === 'cancelled') {
      return [];
    }
    const text = entry.error === null ? FALLBACK_PROBLEM : describeError(entry.error);
    return [{ page, position, source: 'count', text }];
  });
}

export function arbeitStatus(arbeit: Arbeit, entries: Entries, review: ReviewState): ArbeitStatus {
  const counted = buildResults([arbeit], entries)[0];
  const reviewed = summarizeArbeit(arbeit, review, entries);
  const uncertain = arbeit.pages.reduce((sum, page) => {
    const hints = review.pages[page.id]?.result?.hints;
    return sum + (hints === undefined ? 0 : openHints(hints));
  }, 0);
  return {
    hasResults: arbeit.pages.some(
      (page) => entries[page.id] !== undefined || review.pages[page.id] !== undefined,
    ),
    words:
      counted === undefined || counted.countedPages === 0
        ? null
        : { value: counted.words, partial: counted.countedPages < counted.pageCount },
    errors:
      reviewed.statistics === null
        ? null
        : { value: reviewed.statistics.errors, partial: !reviewed.complete },
    uncertain,
    activity: activityOf(arbeit, entries, review),
    problems: problemsOf(arbeit, entries, review),
  };
}

export function figureText(figure: Figure, singular: string, plural: string): string {
  const count = figure.value.toLocaleString('de-DE');
  const noun = figure.value === 1 ? singular : plural;
  return `${figure.partial ? 'mind. ' : ''}${count} ${noun}`;
}

export function activityText(activity: Activity): string {
  switch (activity) {
    case 'waiting':
      return 'Wartet';
    case 'recognizing':
      return 'Erkennt …';
    case 'correcting':
      return 'Korrigiert …';
    default: {
      const unreachable: never = activity;
      return unreachable;
    }
  }
}

export function problemText(problems: readonly PageProblem[]): string {
  const [first] = problems;
  if (first === undefined) return '';
  return problems.length === 1
    ? `Seite ${first.position}: ${first.text}`
    : `${problems.length} Seiten mit Fehlern`;
}
