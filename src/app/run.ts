import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { reviewsContent } from '../content-form/review.ts';
import type { CorrectorStatus } from '../correction/provider.ts';
import { DEFAULT_SCOPE, type CorrectionScope } from '../correction/scope.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { DownloadError } from '../models/types.ts';
import { startablePages, type PageEntry, type RunState } from '../pipeline/runner.ts';
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
  durationText,
  NO_WORK,
  remainingSeconds,
  remainingText,
  totalSeconds,
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
  secondReading = false,
  detecting = false,
): Workload {
  const open = openPages(kind, pages, count, review, profile);
  const read = open.filter((page) => count.entries[page.id]?.status !== 'done').length;
  const confirm = secondReading ? read : 0;
  if (kind === 'count') return { ...NO_WORK, read, confirm };
  const ids = new Set(open.map((page) => page.id));
  const touched = worksTouching(arbeiten, ids);
  return {
    read,
    confirm,
    detect: detecting ? touched : 0,
    correct: scope.spelling || scope.grammar ? open.length : 0,
    review: reviewsContent(scope) ? touched : 0,
  };
}

const PAGE_WEIGHT = { transcribing: 0.6, locating: 0.05, correcting: 0.35 } as const;

const REVIEW_WEIGHT = 0.15;

type Weights = Readonly<Record<Exclude<ReviewPhase, 'detecting' | 'awaiting'>, number>>;

function phaseWeights(run: ReviewRun): Weights {
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

const DETECTING_TEXT = 'Personenbezug wird erkannt …';

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

function awaitsSecond(entry: PageEntry | undefined, secondReading: boolean): boolean {
  if (entry === undefined || entry.status === 'error') return false;
  if (entry.awaitingSecond === true) return true;
  return secondReading && (entry.status === 'waiting' || entry.status === 'running');
}

function secondLeft(count: RunState, pageIds: readonly string[]): number {
  const secondReading = count.secondReading === true;
  return pageIds.filter((id) => awaitsSecond(count.entries[id], secondReading)).length;
}

export function reviewFraction(
  review: ReviewState,
  count: RunState,
  pageIds: readonly string[],
): number {
  const { run } = review;
  if (run === null) return 0;
  const { transcribing, locating, correcting, reviewing } = phaseWeights(run);
  if (run.pending !== undefined) {
    const before = transcribing + locating + (run.pending.withCorrection ? 0 : correcting);
    return before + (1 - before) * share(run.finished, run.total);
  }
  if (run.phase === 'transcribing') {
    const transcribed = pageIds.filter((id) => {
      const status = count.entries[id]?.status;
      return status === 'done' || status === 'error';
    }).length;
    const secondTotal =
      count.secondReading === true
        ? pageIds.filter((id) => count.entries[id]?.status !== 'error').length
        : 0;
    const confirmed = secondTotal - secondLeft(count, pageIds);
    return transcribing * share(transcribed + confirmed, pageIds.length + secondTotal);
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
    const read = Math.max(0, batch.total - batch.finished);
    const confirm = secondLeft(count, Object.keys(count.entries));
    return {
      step: read === 0 && confirm > 0 ? 'confirm' : 'read',
      left: { ...NO_WORK, read, confirm },
    };
  }
  const pageIds = start?.pageIds ?? activePageIds(review);
  const pagesStage = run.stages?.pages !== false;
  const reviewLeft = run.stages?.review === true ? (start?.works ?? 0) : 0;
  const detectLeft = run.stages?.detect === true ? (start?.works ?? 0) : 0;
  const status = (id: string) => count.entries[id]?.status;
  if (run.phase === 'transcribing') {
    const read = pageIds.filter((id) => status(id) !== 'done' && status(id) !== 'error').length;
    const confirm = secondLeft(count, pageIds);
    return {
      step: read === 0 && confirm > 0 ? 'confirm' : 'read',
      left: {
        read,
        confirm,
        detect: detectLeft,
        correct: pagesStage ? pageIds.filter((id) => status(id) !== 'error').length : 0,
        review: reviewLeft,
      },
    };
  }
  if (run.pending !== undefined) {
    const { correct } = run.pending;
    const left = {
      ...NO_WORK,
      detect: run.pending.detect ?? 0,
      correct,
      review: run.pending.review,
    };
    if (run.phase === 'detecting') return { step: 'detect', left };
    if (run.phase !== 'correcting' && run.phase !== 'reviewing') return null;
    return {
      step: run.phase === 'reviewing' || correct === 0 ? 'review' : 'correct',
      left,
    };
  }
  const left = Math.max(0, run.total - run.finished);
  if (run.phase === 'locating') {
    return {
      step: 'correct',
      left: { ...NO_WORK, detect: detectLeft, correct: run.total, review: reviewLeft },
    };
  }
  if (run.phase === 'correcting') {
    return {
      step: 'correct',
      left: { ...NO_WORK, detect: detectLeft, correct: left, review: reviewLeft },
    };
  }
  return { step: 'review', left: { ...NO_WORK, review: left } };
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

function waitingDetail(run: ReviewRun, estimator: Estimator): string | null {
  const { pending } = run;
  if (pending === undefined) return null;
  if (run.phase === 'detecting') return DETECTING_TEXT;
  if (run.phase !== 'awaiting') return null;
  const waiting = `Wartet auf Freigabe (${arbeitenText(pending.confirm)})`;
  const after = durationText(
    totalSeconds(estimator.rates, { ...NO_WORK, correct: pending.correct, review: pending.review }),
  );
  return after === null ? waiting : `${waiting}, danach ${after}`;
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
      detail:
        waitingDetail(run, estimator) ??
        (loading ? LOADING_TEXT : remainingDetail(review, count, start, estimator, now)),
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

export type PowerInvoke = (command: 'power_hold' | 'power_release') => Promise<unknown>;

export interface PowerHold {
  readonly set: (active: boolean) => void;
}

export function createPowerHold(invoke: PowerInvoke = tauriInvoke): PowerHold {
  let wanted = false;
  let queue: Promise<void> = Promise.resolve();
  return {
    set(active) {
      if (active === wanted) return;
      wanted = active;
      const command = active ? 'power_hold' : 'power_release';
      queue = queue
        .then(() => invoke(command))
        .then(
          () => undefined,
          () => undefined,
        );
    },
  };
}
