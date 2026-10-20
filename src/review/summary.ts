import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { PageEntry } from '../pipeline/runner.ts';
import type { Statistics } from '../stats/statistics.ts';
import { isStale, type ReviewPage, type ReviewState } from './review-flow.ts';

export type Entries = Readonly<Record<string, PageEntry>>;

export type PageCondition = 'corrected' | 'empty' | 'stale' | 'problem' | 'open';

export interface ArbeitReview {
  readonly id: string;
  readonly name: string;
  readonly pageCount: number;
  readonly corrected: number;
  readonly empty: number;
  readonly stale: number;
  readonly problems: number;
  readonly open: number;
  readonly complete: boolean;
  readonly preview: boolean;
  readonly statistics: Statistics | null;
}

export interface ClassReview {
  readonly arbeiten: readonly ArbeitReview[];
  readonly statistics: Statistics | null;
  readonly reviewed: number;
  readonly incomplete: number;
}

export interface TypeCount {
  readonly type: string;
  readonly count: number;
}

export function combineStatistics(list: readonly Statistics[]): Statistics | null {
  if (list.length === 0) return null;
  let words = 0;
  let errors = 0;
  const byType: Record<string, number> = {};
  for (const statistics of list) {
    words += statistics.words;
    errors += statistics.errors;
    for (const [type, count] of Object.entries(statistics.errorsByType)) {
      byType[type] = (byType[type] ?? 0) + count;
    }
  }
  return {
    words,
    errors,
    errorsByType: byType,
    errorsPer100Words: words === 0 ? 0 : (errors / words) * 100,
  };
}

export function sortedTypes(statistics: Statistics, order: readonly string[] = []): TypeCount[] {
  const rank = (type: string) => {
    const index = order.indexOf(type);
    return index < 0 ? order.length : index;
  };
  return Object.entries(statistics.errorsByType)
    .map(([type, count]) => ({ type, count }))
    .filter((entry) => entry.count > 0)
    .toSorted((a, b) => b.count - a.count || rank(a.type) - rank(b.type));
}

export function pageCondition(
  page: ImportPage,
  review: ReviewPage | undefined,
  entries: Entries,
): PageCondition {
  if (review === undefined) return 'open';
  if (isStale(review, page, entries[page.id])) return 'stale';
  switch (review.status) {
    case 'done':
      return 'corrected';
    case 'empty':
      return 'empty';
    case 'unreadable':
    case 'failed':
    case 'cancelled':
      return 'problem';
    case 'waiting':
    case 'transcribing':
    case 'locating':
    case 'correcting':
      return 'open';
    default: {
      const unreachable: never = review.status;
      return unreachable;
    }
  }
}

export function summarizeArbeit(
  arbeit: Arbeit,
  state: ReviewState,
  entries: Entries,
): ArbeitReview {
  const counts: Record<PageCondition, number> = {
    corrected: 0,
    empty: 0,
    stale: 0,
    problem: 0,
    open: 0,
  };
  const corrected: Statistics[] = [];
  let preview = false;
  for (const page of arbeit.pages) {
    const review = state.pages[page.id];
    const condition = pageCondition(page, review, entries);
    counts[condition] += 1;
    if (condition === 'corrected' && review?.result) {
      corrected.push(review.result.statistics);
      preview ||= review.result.preview;
    }
  }
  return {
    id: arbeit.id,
    name: arbeit.name,
    pageCount: arbeit.pages.length,
    corrected: counts.corrected,
    empty: counts.empty,
    stale: counts.stale,
    problems: counts.problem,
    open: counts.open,
    complete: counts.corrected + counts.empty === arbeit.pages.length,
    preview,
    statistics: combineStatistics(corrected),
  };
}

export function summarizeClass(
  arbeiten: readonly Arbeit[],
  state: ReviewState,
  entries: Entries,
): ClassReview {
  const summaries = arbeiten.map((arbeit) => summarizeArbeit(arbeit, state, entries));
  const reviewed = summaries.filter((summary) => summary.statistics !== null);
  return {
    arbeiten: summaries,
    statistics: combineStatistics(reviewed.flatMap((summary) => summary.statistics ?? [])),
    reviewed: reviewed.length,
    incomplete: reviewed.filter((summary) => !summary.complete).length,
  };
}

export function incompleteText(arbeit: ArbeitReview): string {
  return `Unvollständig: ${arbeit.corrected + arbeit.empty} von ${arbeit.pageCount} Seiten berichtigt`;
}

export function formatRate(rate: number): string {
  return rate.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function errorsText(count: number): string {
  return count === 1 ? '1 Fehler' : `${count.toLocaleString('de-DE')} Fehler`;
}
