import type { Arbeit } from '../import/arbeiten.ts';
import type { Statistics } from '../stats/statistics.ts';
import type { ReviewPage, ReviewState } from './review-flow.ts';

export interface ArbeitReview {
  readonly id: string;
  readonly name: string;
  readonly pageCount: number;
  readonly corrected: number;
  readonly empty: number;
  readonly problems: number;
  readonly open: number;
  readonly statistics: Statistics | null;
}

export interface ClassReview {
  readonly arbeiten: readonly ArbeitReview[];
  readonly statistics: Statistics | null;
  readonly reviewed: number;
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

function countWhere(
  pages: readonly (ReviewPage | undefined)[],
  test: (page: ReviewPage) => boolean,
) {
  return pages.filter((page) => page !== undefined && test(page)).length;
}

export function summarizeArbeit(arbeit: Arbeit, state: ReviewState): ArbeitReview {
  const pages = arbeit.pages.map((page) => state.pages[page.id]);
  const statistics = combineStatistics(
    pages.flatMap((page) => (page?.result ? [page.result.statistics] : [])),
  );
  const corrected = countWhere(pages, (page) => page.status === 'done');
  const empty = countWhere(pages, (page) => page.status === 'empty');
  const problems = countWhere(pages, (page) =>
    ['unreadable', 'failed', 'cancelled'].includes(page.status),
  );
  return {
    id: arbeit.id,
    name: arbeit.name,
    pageCount: arbeit.pages.length,
    corrected,
    empty,
    problems,
    open: arbeit.pages.length - corrected - empty - problems,
    statistics,
  };
}

export function summarizeClass(arbeiten: readonly Arbeit[], state: ReviewState): ClassReview {
  const summaries = arbeiten.map((arbeit) => summarizeArbeit(arbeit, state));
  const reviewed = summaries.filter((summary) => summary.statistics !== null);
  return {
    arbeiten: summaries,
    statistics: combineStatistics(reviewed.flatMap((summary) => summary.statistics ?? [])),
    reviewed: reviewed.length,
  };
}

export function formatRate(rate: number): string {
  return rate.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function errorsText(count: number): string {
  return count === 1 ? '1 Fehler' : `${count.toLocaleString('de-DE')} Fehler`;
}
