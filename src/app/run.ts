import type { CorrectionProfile } from '../annotations/profile.ts';
import type { CorrectorStatus } from '../correction/provider.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import type { DownloadError } from '../models/types.ts';
import { describeProgress, formatRemaining } from '../pipeline/progress.ts';
import { startablePages, type RunState } from '../pipeline/runner.ts';
import type { TranscriberStatus } from '../pipeline/transcriber.ts';
import { buildResults, classTotals, pagesText, wordsText } from '../results/summary.ts';
import { engineText, type ReviewEngine } from '../review/engine-phase.ts';
import type { ReviewState } from '../review/review-flow.ts';
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

const PHASE_TEXT = {
  transcribing: 'Texterkennung',
  locating: 'Zeilen suchen',
  correcting: 'Korrektur',
} as const;

function remaining(count: RunState, now: number): string | null {
  const progress = describeProgress(count, now);
  if (progress === null || progress.remainingMs === null) return null;
  return `noch ${formatRemaining(progress.remainingMs)}`;
}

function position(finished: number, total: number): string {
  return `Seite ${Math.min(finished + 1, total)} von ${total}`;
}

export function runProgress(
  review: ReviewState,
  count: RunState,
  engine: ReviewEngine,
  now: number,
): RunProgress | null {
  const { run } = review;
  if (run !== null) {
    if (review.stopping) return { label: 'Wird abgebrochen …', detail: null, value: null, max: 1 };
    const phase = PHASE_TEXT[run.phase];
    const extra =
      engineText(run, engine) ?? (run.phase === 'transcribing' ? remaining(count, now) : null);
    const detail = extra === null ? phase : `${phase} · ${extra}`;
    if (run.total === 0) return { label: `${phase} …`, detail: extra, value: null, max: 1 };
    return {
      label: position(run.finished, run.total),
      detail,
      value: run.finished,
      max: run.total,
    };
  }
  const { batch } = count;
  if (batch === null) return null;
  const starting = engine.transcriber === 'starting';
  return {
    label: position(batch.finished, batch.total),
    detail: starting ? 'Texterkennung startet …' : remaining(count, now),
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
  const parts = [`Fertig: ${corrected} von ${pagesText(pages)} korrigiert.`];
  if (problems > 0) parts.push(`${pagesText(problems)} mit Fehlern.`);
  return parts.join(' ');
}
