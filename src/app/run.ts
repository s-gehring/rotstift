import type { CorrectionProfile } from '../annotations/profile.ts';
import type { CorrectorStatus } from '../correction/provider.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { DownloadError } from '../models/types.ts';
import { describeProgress, formatRemaining } from '../pipeline/progress.ts';
import { startablePages, type RunState } from '../pipeline/runner.ts';
import type { TranscriberStatus } from '../pipeline/transcriber.ts';
import {
  arbeitenText,
  buildResults,
  classTotals,
  pagesText,
  wordsText,
} from '../results/summary.ts';
import { engineText, type ReviewEngine } from '../review/engine-phase.ts';
import type { ReviewPhase, ReviewRun, ReviewState, ReviewStatus } from '../review/review-flow.ts';
import { pageCondition, summarizeClass } from '../review/summary.ts';
import type { ModelRole, RunKind, RunProgress } from './types.ts';

export const RUN_KIND_STORAGE_KEY = 'rotstift.run-kind';

export type KindStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): KindStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadRunKind(storage: KindStorage | null = defaultStorage()): RunKind {
  try {
    return storage?.getItem(RUN_KIND_STORAGE_KEY) === 'count' ? 'count' : 'correct';
  } catch {
    return 'correct';
  }
}

export function saveRunKind(kind: RunKind, storage: KindStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(RUN_KIND_STORAGE_KEY, kind);
  } catch {
    return;
  }
}

export const NEEDED_ROLES: Readonly<Record<RunKind, readonly ModelRole[]>> = {
  count: ['transcriber'],
  correct: ['transcriber', 'corrector'],
};

export type Readiness = 'ready' | 'checking' | 'missing' | 'unavailable';

export function readiness(
  status: TranscriberStatus | CorrectorStatus | null,
  loadError: DownloadError | null,
): Readiness {
  if (status === null) return loadError === null ? 'checking' : 'missing';
  if (status.state === 'ready') return 'ready';
  return status.state === 'needs-model' ? 'missing' : 'unavailable';
}

export type StartDecision =
  | { readonly action: 'launch' }
  | { readonly action: 'setup'; readonly roles: readonly ModelRole[] }
  | { readonly action: 'unavailable' }
  | { readonly action: 'wait' };

export function startDecision(
  kind: RunKind,
  roles: Readonly<Record<ModelRole, Readiness>>,
): StartDecision {
  const needed = NEEDED_ROLES[kind];
  if (needed.some((role) => roles[role] === 'unavailable')) return { action: 'unavailable' };
  const missing = needed.filter((role) => roles[role] === 'missing');
  if (missing.length > 0) return { action: 'setup', roles: missing };
  if (needed.some((role) => roles[role] === 'checking')) return { action: 'wait' };
  return { action: 'launch' };
}

export function openPageCount(
  kind: RunKind,
  pages: readonly ImportPage[],
  count: RunState,
  review: ReviewState,
  profile: CorrectionProfile,
): number {
  if (kind === 'count') return startablePages(pages, count).queue.length;
  if (review.profile !== null && review.profile.id !== profile.id) return pages.length;
  return pages.filter((page) => {
    const condition = pageCondition(page, review.pages[page.id], count.entries);
    return condition !== 'corrected' && condition !== 'empty';
  }).length;
}

const PAGE_WEIGHT = { transcribing: 0.6, locating: 0.05, correcting: 0.35 } as const;

const REVIEW_WEIGHT = 0.15;

function phaseWeights(run: ReviewRun): Readonly<Record<ReviewPhase, number>> {
  if (run.stages?.pages === false) {
    return { transcribing: 0, locating: 0, correcting: 0, reviewing: 1 };
  }
  const reviewing = run.stages?.review === true ? REVIEW_WEIGHT : 0;
  const scale = 1 - reviewing;
  return {
    transcribing: PAGE_WEIGHT.transcribing * scale,
    locating: PAGE_WEIGHT.locating * scale,
    correcting: PAGE_WEIGHT.correcting * scale,
    reviewing,
  };
}

const FINISHED: ReadonlySet<ReviewStatus> = new Set([
  'done',
  'empty',
  'unreadable',
  'failed',
  'cancelled',
]);

const LOADING_TEXT = 'Modell wird geladen …';

export interface RunStart {
  readonly pageIds: readonly string[];
  readonly at: number;
  readonly fraction: number;
}

function activePageIds(review: ReviewState): string[] {
  return Object.entries(review.pages)
    .filter(([, page]) => !FINISHED.has(page.status))
    .map(([id]) => id);
}

function share(finished: number, total: number): number {
  return total === 0 ? 1 : Math.min(1, finished / total);
}

export function reviewFraction(
  review: ReviewState,
  count: RunState,
  pageIds: readonly string[],
): number {
  const { run } = review;
  if (run === null) return 0;
  const { transcribing, locating, correcting, reviewing } = phaseWeights(run);
  if (run.phase === 'transcribing') {
    const transcribed = pageIds.filter((id) => {
      const status = count.entries[id]?.status;
      return status === 'done' || status === 'error';
    }).length;
    return transcribing * share(transcribed, pageIds.length);
  }
  if (run.phase === 'locating') return transcribing + locating * share(run.finished, run.total);
  if (run.phase === 'correcting') {
    return transcribing + locating + correcting * share(run.finished, run.total);
  }
  return transcribing + locating + correcting + reviewing * share(run.finished, run.total);
}

export function startRun(review: ReviewState, count: RunState, at: number): RunStart {
  const pageIds = activePageIds(review);
  return { pageIds, at, fraction: reviewFraction(review, count, pageIds) };
}

function countRemaining(count: RunState, now: number): string | null {
  const progress = describeProgress(count, now);
  if (progress === null || progress.remainingMs === null) return null;
  return `noch ${formatRemaining(progress.remainingMs)}`;
}

function reviewRemaining(fraction: number, start: RunStart, now: number): string | null {
  const gained = fraction - start.fraction;
  const elapsed = now - start.at;
  if (gained <= 0 || elapsed <= 0) return null;
  return `noch ${formatRemaining((elapsed * (1 - fraction)) / gained)}`;
}

function pagesLabel(finished: number, total: number): string {
  return `Seite ${Math.min(finished, total)} von ${total}`;
}

export function runProgress(
  review: ReviewState,
  count: RunState,
  engine: ReviewEngine,
  now: number,
  start: RunStart | null = null,
): RunProgress | null {
  const { run } = review;
  if (run !== null) {
    if (review.stopping) return { label: 'Wird abgebrochen …', detail: null, value: null, max: 1 };
    const pageIds = start?.pageIds ?? activePageIds(review);
    const fraction = reviewFraction(review, count, pageIds);
    const percent = Math.round(fraction * 100);
    const loading = engineText(run, engine) !== null;
    return {
      label: `${percent}\u00a0%`,
      detail: loading
        ? LOADING_TEXT
        : start === null
          ? null
          : reviewRemaining(fraction, start, now),
      value: percent,
      max: 100,
    };
  }
  const { batch } = count;
  if (batch === null) return null;
  return {
    label: pagesLabel(batch.finished, batch.total),
    detail: engine.transcriber === 'starting' ? LOADING_TEXT : countRemaining(count, now),
    value: batch.finished,
    max: batch.total,
  };
}

export function countFinishedText(arbeiten: readonly Arbeit[], count: RunState): string {
  const results = buildResults(arbeiten, count.entries);
  const totals = classTotals(results);
  const failed = results
    .flatMap((result) => result.rows)
    .filter((row) => row.status === 'error').length;
  const parts = [`Fertig: ${wordsText(totals.words)} auf ${pagesText(totals.countedPages)}.`];
  if (failed > 0) parts.push(`${pagesText(failed)} nicht erkannt.`);
  return parts.join(' ');
}

export function reviewFinishedText(
  arbeiten: readonly Arbeit[],
  review: ReviewState,
  count: RunState,
): string {
  const summary = summarizeClass(arbeiten, review, count.entries);
  const pages = summary.arbeiten.reduce((sum, arbeit) => sum + arbeit.pageCount, 0);
  const corrected = summary.arbeiten.reduce((sum, arbeit) => sum + arbeit.corrected, 0);
  const problems = summary.arbeiten.reduce((sum, arbeit) => sum + arbeit.problems, 0);
  const unchecked = arbeiten.filter((arbeit) => review.works[arbeit.id]?.status === 'failed');
  const parts = [`Fertig: ${corrected} von ${pagesText(pages)} korrigiert.`];
  if (problems > 0) parts.push(`${pagesText(problems)} mit Fehlern.`);
  if (unchecked.length > 0) {
    parts.push(`Inhalt und Form bei ${arbeitenText(unchecked.length)} nicht geprüft.`);
  }
  return parts.join(' ');
}
