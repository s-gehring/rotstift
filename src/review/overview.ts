import type { Arbeit } from '../import/arbeiten.ts';
import { activeLimits, gradeFor, type GradeScale, type Grading } from '../stats/grading.ts';
import type { Weighting } from '../stats/weighting.ts';
import { buildResults, classTotals } from '../results/summary.ts';
import type { ReviewState } from './review-flow.ts';
import {
  sortedTypes,
  summarizeArbeit,
  summarizeClass,
  weighArbeit,
  weighClass,
  type ArbeitReview,
  type Entries,
  type TypeCount,
} from './summary.ts';

export interface OverviewTag {
  readonly text: string;
  readonly title: string;
}

export interface OverviewRow {
  readonly id: string;
  readonly name: string;
  readonly words: number | null;
  readonly errors: number | null;
  readonly weighted: number | null;
  readonly quotient: number | null;
  readonly grade: string | null;
  readonly top: readonly TypeCount[];
  readonly tag: OverviewTag | null;
}

export interface OverviewTotal {
  readonly words: number;
  readonly errors: number | null;
  readonly weighted: number | null;
  readonly quotient: number | null;
  readonly average: number | null;
}

export interface Overview {
  readonly corrected: boolean;
  readonly rows: readonly OverviewRow[];
  readonly total: OverviewTotal | null;
  readonly types: readonly TypeCount[];
  readonly scale: GradeScale | null;
}

const TOP_TYPES = 3;

function pages(count: number): string {
  return count === 1 ? '1 Seite' : `${count} Seiten`;
}

function correctedTag(summary: ArbeitReview): OverviewTag | null {
  if (summary.complete) return null;
  const finished = summary.corrected + summary.empty;
  const parts = [`${finished} von ${pages(summary.pageCount)} korrigiert`];
  if (summary.problems > 0) parts.push(`${summary.problems} mit Fehler`);
  if (summary.stale > 0) parts.push(`${summary.stale} geändert`);
  if (summary.open > 0) parts.push(`${summary.open} offen`);
  return { text: `${finished}/${summary.pageCount}`, title: parts.join(', ') };
}

export function buildOverview(
  arbeiten: readonly Arbeit[],
  review: ReviewState,
  entries: Entries,
  order: readonly string[] = [],
  weighting: Weighting | null = null,
  grading: Grading | null = null,
): Overview {
  const corrected = Object.keys(review.pages).length > 0;
  const profile = review.profile;
  const scale =
    corrected && grading !== null && activeLimits(grading) !== null ? grading.scale : null;
  if (corrected) {
    const summary = summarizeClass(arbeiten, review, entries);
    const total = summary.statistics;
    const weightedTotal =
      profile === null || weighting === null
        ? null
        : weighClass(summary.arbeiten, profile, weighting);
    return {
      corrected,
      rows: arbeiten.map((arbeit) => {
        const row = summarizeArbeit(arbeit, review, entries);
        const statistics = row.statistics;
        const weighted =
          profile === null || weighting === null ? null : weighArbeit(row, profile, weighting);
        return {
          id: arbeit.id,
          name: arbeit.name,
          words: statistics?.words ?? null,
          errors: statistics?.errors ?? null,
          weighted: weighted?.weighted ?? null,
          quotient: weighted?.quotient ?? null,
          grade:
            scale === null || grading === null || !row.complete
              ? null
              : gradeFor(weighted, grading),
          top: statistics === null ? [] : sortedTypes(statistics, order).slice(0, TOP_TYPES),
          tag: correctedTag(row),
        };
      }),
      total:
        total === null
          ? null
          : {
              words: total.words,
              errors: total.errors,
              weighted: weightedTotal?.weighted ?? null,
              quotient: weightedTotal?.quotient ?? null,
              average: null,
            },
      types: total === null ? [] : sortedTypes(total, order),
      scale,
    };
  }
  const results = buildResults(arbeiten, entries);
  const totals = classTotals(results);
  return {
    corrected,
    rows: results.map((result) => ({
      id: result.id,
      name: result.name,
      words: result.countedPages === 0 ? null : result.words,
      errors: null,
      weighted: null,
      quotient: null,
      grade: null,
      top: [],
      tag:
        result.countedPages === result.pageCount
          ? null
          : {
              text: `${result.countedPages}/${result.pageCount}`,
              title: `${result.countedPages} von ${pages(result.pageCount)} gezählt`,
            },
    })),
    total:
      totals.countedPages === 0
        ? null
        : {
            words: totals.words,
            errors: null,
            weighted: null,
            quotient: null,
            average: totals.average,
          },
    types: [],
    scale: null,
  };
}
