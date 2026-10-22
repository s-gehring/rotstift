import type { CorrectionProfile } from '../annotations/profile.ts';
import { reviewsContent } from '../content-form/review.ts';
import type { CorrectorStatus } from '../correction/provider.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../correction/scope.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { DownloadError } from '../models/types.ts';
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
import {
  createEstimator,
  NO_WORK,
  remainingSeconds,
  remainingText,
  type Estimator,
  type Snapshot,
  type Workload,
} from './estimate.ts';
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

export function neededRoles(kind: RunKind, scope: CorrectionScope): readonly ModelRole[] {
  if (kind === 'count') return ['transcriber'];
  const roles: ModelRole[] = ['transcriber'];
  if (scope.spelling || scope.grammar) roles.push('corrector');
  if (reviewsContent(scope)) roles.push('reviewer');
  return roles;
}

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
  scope: CorrectionScope = DEFAULT_SCOPE,
): StartDecision {
  const needed = neededRoles(kind, scope);
  if (needed.some((role) => roles[role] === 'unavailable')) return { action: 'unavailable' };
  const missing = needed.filter((role) => roles[role] === 'missing');
  if (missing.length > 0) return { action: 'setup', roles: missing };
  if (needed.some((role) => roles[role] === 'checking')) return { action: 'wait' };
  return { action: 'launch' };
}

function openPages(
  kind: RunKind,
  pages: readonly ImportPage[],
  count: RunState,
  review: ReviewState,
  profile: CorrectionProfile,
): readonly ImportPage[] {
  if (kind === 'count') return startablePages(pages, count).queue;
  if (review.profile !== null && review.profile.id !== profile.id) return pages;
  return pages.filter((page) => {
    const condition = pageCondition(page, review.pages[page.id], count.entries);
    return condition !== 'corrected' && condition !== 'empty';
  });
}

export function openPageCount(
  kind: RunKind,
  pages: readonly ImportPage[],
  count: RunState,
  review: ReviewState,
  profile: CorrectionProfile,
): number {
  return openPages(kind, pages, count, review, profile).length;
}

type ArbeitPages = readonly { readonly pages: readonly { readonly id: string }[] }[];

function worksTouching(arbeiten: ArbeitPages, pageIds: ReadonlySet<string>): number {
  return arbeiten.filter((arbeit) => arbeit.pages.some((page) => pageIds.has(page.id))).length;
}

export function startWorkload(
  kind: RunKind,
  pages: readonly ImportPage[],
  arbeiten: ArbeitPages,
  count: RunState,
  review: ReviewState,
  profile: CorrectionProfile,
  scope: CorrectionScope,
): Workload {
  const open = openPages(kind, pages, count, review, profile);
  const read = open.filter((page) => count.entries[page.id]?.status !== 'done').length;
  if (kind === 'count') return { ...NO_WORK, read };
  const ids = new Set(open.map((page) => page.id));
  return {
    read,
    correct: scope.spelling || scope.grammar ? open.length : 0,
    review: reviewsContent(scope) ? worksTouching(arbeiten, ids) : 0,
  };
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
  readonly works: number;
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

export function startRun(
  review: ReviewState,
  count: RunState,
  at: number,
  arbeiten: ArbeitPages = [],
): RunStart {
  const pageIds = activePageIds(review);
  return {
    pageIds,
    works: worksTouching(arbeiten, new Set(pageIds)),
    at,
    fraction: reviewFraction(review, count, pageIds),
  };
}

export function runSnapshot(
  review: ReviewState,
  count: RunState,
  start: RunStart | null,
): Snapshot | null {
  const { run } = review;
  if (run === null) {
    const { batch } = count;
    if (batch === null) return null;
    return { step: 'read', left: { ...NO_WORK, read: Math.max(0, batch.total - batch.finished) } };
  }
  const pageIds = start?.pageIds ?? activePageIds(review);
  const pagesStage = run.stages?.pages !== false;
  const reviewLeft = run.stages?.review === true ? (start?.works ?? 0) : 0;
  const status = (id: string) => count.entries[id]?.status;
  if (run.phase === 'transcribing') {
    return {
      step: 'read',
      left: {
        read: pageIds.filter((id) => status(id) !== 'done' && status(id) !== 'error').length,
        correct: pagesStage ? pageIds.filter((id) => status(id) !== 'error').length : 0,
        review: reviewLeft,
      },
    };
  }
  const left = Math.max(0, run.total - run.finished);
  if (run.phase === 'locating') {
    return { step: 'correct', left: { read: 0, correct: run.total, review: reviewLeft } };
  }
  if (run.phase === 'correcting') {
    return { step: 'correct', left: { read: 0, correct: left, review: reviewLeft } };
  }
  return { step: 'review', left: { read: 0, correct: 0, review: left } };
}

function remainingDetail(
  review: ReviewState,
  count: RunState,
  start: RunStart | null,
  estimator: Estimator,
  now: number,
): string | null {
  const snapshot = runSnapshot(review, count, start);
  if (snapshot === null) return null;
  return remainingText(remainingSeconds(estimator, snapshot, now));
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
  estimator: Estimator = createEstimator(),
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
      detail: loading ? LOADING_TEXT : remainingDetail(review, count, start, estimator, now),
      value: percent,
      max: 100,
    };
  }
  const { batch } = count;
  if (batch === null) return null;
  return {
    label: pagesLabel(batch.finished, batch.total),
    detail:
      engine.transcriber === 'starting'
        ? LOADING_TEXT
        : remainingDetail(review, count, start, estimator, now),
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
