import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Bbox, Transcript } from '../annotations/transcript.ts';
import { correctPage, type CorrectPageResult } from '../correction/correct-page.ts';
import { describeCorrectError, type Corrector } from '../correction/corrector.ts';
import {
  separateUncertain,
  withAcceptedHints,
  type HintStatus,
  type PageReading,
  type ReadingHint,
} from '../correction/uncertain-reading.ts';
import type { ImportPage, Rotation } from '../import/pages.ts';
import type { LayoutLocator } from '../layout/layout-client.ts';
import type { LayoutResult } from '../layout/types.ts';
import type { PageEntry, Runner } from '../pipeline/runner.ts';
import { describeError } from '../pipeline/transcriber.ts';
import { computeStatistics, type Statistics } from '../stats/statistics.ts';

export interface ReviewImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

export type ReviewPhase = 'transcribing' | 'locating' | 'correcting';

export type ReviewStatus =
  'waiting' | ReviewPhase | 'done' | 'empty' | 'unreadable' | 'failed' | 'cancelled';

export interface CorrectedPage {
  readonly transcript: Transcript;
  readonly baseTranscript: Transcript;
  readonly hints: readonly ReadingHint[];
  readonly statistics: Statistics;
  readonly droppedMarks: number;
  readonly unplacedLines: readonly number[];
  readonly preview: boolean;
}

export interface PageWarning {
  readonly text: string;
  readonly detail: string;
}

export interface ReviewPage {
  readonly status: ReviewStatus;
  readonly rotation: Rotation;
  readonly source: string | null;
  readonly image: ReviewImage | null;
  readonly bboxes: readonly (Bbox | undefined)[] | null;
  readonly warning: PageWarning | null;
  readonly result: CorrectedPage | null;
  readonly message: string | null;
  readonly detail: string | null;
}

export interface ReviewRun {
  readonly phase: ReviewPhase;
  readonly total: number;
  readonly finished: number;
}

export interface ReviewState {
  readonly pages: Readonly<Record<string, ReviewPage>>;
  readonly profile: CorrectionProfile | null;
  readonly run: ReviewRun | null;
  readonly stopping: boolean;
  readonly outcome: 'finished' | 'cancelled' | null;
}

export type TranscriptionSource = Pick<
  Runner,
  'start' | 'enqueue' | 'cancel' | 'getState' | 'subscribe'
>;

export interface ReviewDeps {
  readonly transcription: TranscriptionSource;
  readonly locator: Pick<LayoutLocator, 'locate'>;
  readonly loadImage: (page: ImportPage) => Promise<ReviewImage>;
}

export const CORRECTOR_MISSING =
  'Das Korrekturmodell fehlt. Bitte zuerst das Korrekturmodell einrichten.';

export const IMAGE_FAILED =
  'Das Seitenbild konnte nicht vorbereitet werden. Die Fehler stehen nur in der Liste.';

export const LAYOUT_FAILED =
  'Die Zeilen wurden auf der Seite nicht gefunden. Die Fehler stehen nur in der Liste.';

export const NOT_RERECOGNIZED = 'Die Seite wurde nach dem Drehen nicht neu erkannt.';

const UNREADABLE = 'Die Seite wurde nicht erkannt.';

const UNEXPECTED = 'unerwarteter Fehler';

const EMPTY: ReviewState = {
  pages: {},
  profile: null,
  run: null,
  stopping: false,
  outcome: null,
};

const ABORTED = Symbol('aborted');

const ACTIVE: ReadonlySet<ReviewStatus> = new Set([
  'waiting',
  'transcribing',
  'locating',
  'correcting',
]);

interface Readable {
  readonly page: ImportPage;
  readonly lines: readonly string[];
  readonly reading: PageReading | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function toBboxes(layout: LayoutResult, count: number): (Bbox | undefined)[] {
  return Array.from({ length: count }, (_, index) => {
    const location = layout.lines[index];
    if (location === null || location === undefined) return undefined;
    const { x, y, width, height } = location.bbox;
    if (!(width > 0 && height > 0)) return undefined;
    return { ...location.bbox, x: Math.max(0, x), y: Math.max(0, y) };
  });
}

function unplacedLines(transcript: Transcript): number[] {
  return transcript.lines
    .filter((line) => line.bbox === undefined && line.marks.length > 0)
    .map((line) => line.number);
}

function withHints(
  result: Omit<CorrectedPage, 'transcript' | 'statistics' | 'unplacedLines'>,
): CorrectedPage {
  const transcript = withAcceptedHints(result.baseTranscript, result.hints);
  return {
    ...result,
    transcript,
    statistics: computeStatistics(transcript),
    unplacedLines: unplacedLines(transcript),
  };
}

function blankPage(rotation: Rotation): ReviewPage {
  return {
    status: 'waiting',
    rotation,
    source: null,
    image: null,
    bboxes: null,
    warning: null,
    result: null,
    message: null,
    detail: null,
  };
}

export function sourceOf(entry: PageEntry | undefined): string | null {
  return entry?.hasTranscript ? entry.text : null;
}

export function isStale(
  review: ReviewPage,
  page: Pick<ImportPage, 'rotation'>,
  entry: PageEntry | undefined,
): boolean {
  if (review.status !== 'done' && review.status !== 'empty') return false;
  return review.rotation !== page.rotation || review.source !== sourceOf(entry);
}

function transcriptProblem(entry: PageEntry | undefined, page: ImportPage): string | null {
  if (entry === undefined) return UNREADABLE;
  const reason = entry.error ? describeError(entry.error) : null;
  if (entry.status === 'error' || !entry.hasTranscript) return reason ?? UNREADABLE;
  if (entry.rotation !== page.rotation) return reason ?? NOT_RERECOGNIZED;
  return null;
}

function needsRecognition(entry: PageEntry, page: ImportPage): boolean {
  return entry.status === 'error' || !entry.hasTranscript || entry.rotation !== page.rotation;
}

export function createReviewFlow(deps: ReviewDeps) {
  const { transcription } = deps;
  const listeners = new Set<() => void>();
  let state: ReviewState = EMPTY;
  let active: AbortController | null = null;
  let inflight: Promise<unknown> = Promise.resolve();
  let corrector: Corrector | null = null;
  let preview = false;

  const commit = (next: ReviewState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const patch = (id: string, change: Partial<ReviewPage>) => {
    const page = state.pages[id];
    if (page === undefined) return;
    commit({ ...state, pages: { ...state.pages, [id]: { ...page, ...change } } });
  };

  const setRun = (run: ReviewRun | null) => {
    commit({ ...state, run });
  };

  const track = <T>(promise: Promise<T>): Promise<T> => {
    inflight = promise.then(
      () => undefined,
      () => undefined,
    );
    return promise;
  };

  const isCurrent = (page: ImportPage): boolean => {
    const existing = state.pages[page.id];
    return (
      existing !== undefined &&
      (existing.status === 'done' || existing.status === 'empty') &&
      !isStale(existing, page, transcription.getState().entries[page.id])
    );
  };

  const isIdle = () => {
    const { batch, entries } = transcription.getState();
    return batch === null && !Object.values(entries).some((entry) => entry.status === 'running');
  };

  const untilIdle = (): Promise<void> =>
    new Promise((resolve) => {
      if (isIdle()) {
        resolve();
        return;
      }
      const unsubscribe = transcription.subscribe(() => {
        if (isIdle()) {
          unsubscribe();
          resolve();
        }
      });
    });

  const transcribePhase = async (targets: readonly ImportPage[], begin: () => void) => {
    const ids = targets.map((page) => page.id);
    const mirror = () => {
      const runState = transcription.getState();
      const pages = { ...state.pages };
      for (const id of ids) {
        const page = pages[id];
        if (page === undefined || !ACTIVE.has(page.status)) continue;
        const status = runState.entries[id]?.status === 'running' ? 'transcribing' : 'waiting';
        if (page.status !== status) pages[id] = { ...page, status };
      }
      const batch = runState.batch;
      commit({
        ...state,
        pages,
        run: {
          phase: 'transcribing',
          total: batch?.total ?? 0,
          finished: batch?.finished ?? 0,
        },
      });
    };
    const unsubscribe = transcription.subscribe(mirror);
    try {
      begin();
      mirror();
      await untilIdle();
    } finally {
      unsubscribe();
    }
  };

  const collectTranscripts = (targets: readonly ImportPage[]): Readable[] => {
    const entries = transcription.getState().entries;
    const readable: Readable[] = [];
    for (const page of targets) {
      const entry = entries[page.id];
      const problem = transcriptProblem(entry, page);
      if (entry === undefined || problem !== null) {
        patch(page.id, {
          status: 'unreadable',
          message: problem ?? UNREADABLE,
          detail: null,
          result: null,
        });
        continue;
      }
      const lines = entry.text.split('\n');
      const previous = state.pages[page.id];
      const sameSource = previous?.source === entry.text && previous.rotation === page.rotation;
      if (!sameSource) patch(page.id, { image: null, bboxes: null, warning: null });
      patch(page.id, { source: entry.text, rotation: page.rotation, result: null });
      if (lines.every((line) => line.trim() === '')) {
        patch(page.id, { status: 'empty', message: null, detail: null });
        continue;
      }
      readable.push({ page, lines, reading: entry.reading });
    }
    return readable;
  };

  const locatePage = async (page: ImportPage, lines: readonly string[], signal: AbortSignal) => {
    patch(page.id, { status: 'locating', warning: null });
    let image: ReviewImage | null = null;
    let bboxes: (Bbox | undefined)[] = lines.map(() => undefined);
    let warning: PageWarning | null = null;
    try {
      const loaded = await abortable(track(deps.loadImage(page)), signal);
      if (loaded === ABORTED) return false;
      image = loaded;
    } catch (error) {
      warning = { text: IMAGE_FAILED, detail: errorText(error) };
    }
    if (image !== null) {
      try {
        const layout = await abortable(track(deps.locator.locate(image.blob, lines)), signal);
        if (layout === ABORTED) return false;
        bboxes = toBboxes(layout, lines.length);
      } catch (error) {
        warning = { text: LAYOUT_FAILED, detail: errorText(error) };
      }
    }
    patch(page.id, { status: 'waiting', image, bboxes, warning });
    return true;
  };

  const locatePhase = async (readable: readonly Readable[], signal: AbortSignal) => {
    let finished = 0;
    setRun({ phase: 'locating', total: readable.length, finished });
    for (const { page, lines } of readable) {
      const existing = state.pages[page.id];
      const located = existing?.image != null && existing.bboxes !== null;
      if (!located && !(await locatePage(page, lines, signal))) return;
      finished += 1;
      setRun({ phase: 'locating', total: readable.length, finished });
    }
  };

  const correctPhase = async (
    readable: readonly Readable[],
    profile: CorrectionProfile,
    signal: AbortSignal,
  ) => {
    let finished = 0;
    const current = corrector;
    const isPreview = preview;
    setRun({ phase: 'correcting', total: readable.length, finished });
    for (const { page, lines, reading } of readable) {
      if (signal.aborted) return;
      if (current === null) {
        patch(page.id, { status: 'failed', message: CORRECTOR_MISSING, detail: null });
      } else {
        patch(page.id, { status: 'correcting', message: null, detail: null });
        const bboxes = state.pages[page.id]?.bboxes ?? undefined;
        const work = track(
          correctPage({ lines, profile, corrector: current, signal, ...(bboxes && { bboxes }) }),
        );
        const result = await abortable(work, signal).catch((error: unknown): CorrectPageResult => ({
          ok: false,
          error: { kind: 'failed', message: UNEXPECTED, detail: errorText(error) },
        }));
        if (result === ABORTED) return;
        if (result.ok) {
          const separated = separateUncertain(result.transcript, reading);
          patch(page.id, {
            status: 'done',
            result: withHints({
              baseTranscript: separated.transcript,
              hints: separated.hints,
              droppedMarks: result.droppedMarks,
              preview: isPreview,
            }),
          });
        } else if (result.error.kind === 'cancelled') {
          patch(page.id, { status: 'cancelled' });
        } else {
          const { error } = result;
          patch(page.id, {
            status: 'failed',
            message: describeCorrectError(error),
            detail: error.kind === 'failed' ? (error.detail ?? null) : null,
          });
        }
      }
      finished += 1;
      setRun({ phase: 'correcting', total: readable.length, finished });
    }
  };

  const process = async (
    targets: readonly ImportPage[],
    profile: CorrectionProfile,
    begin: () => void,
  ) => {
    const abort = new AbortController();
    const aborted = () => abort.signal.aborted;
    active = abort;
    const pages = { ...state.pages };
    for (const page of targets) {
      const existing = pages[page.id];
      pages[page.id] =
        existing === undefined
          ? blankPage(page.rotation)
          : { ...existing, status: 'waiting', message: null, detail: null };
    }
    commit({ ...state, pages, profile, outcome: null, stopping: false });
    try {
      await transcribePhase(targets, begin);
      if (aborted()) return;
      const readable = collectTranscripts(targets);
      await locatePhase(readable, abort.signal);
      if (aborted()) return;
      await correctPhase(readable, profile, abort.signal);
    } finally {
      const cancelled = aborted();
      if (cancelled) {
        const next = { ...state.pages };
        for (const page of targets) {
          const entry = next[page.id];
          if (entry !== undefined && ACTIVE.has(entry.status)) {
            next[page.id] = { ...entry, status: 'cancelled' };
          }
        }
        commit({ ...state, pages: next });
        await inflight;
      }
      if (active === abort) active = null;
      commit({
        ...state,
        run: null,
        stopping: false,
        outcome: cancelled ? 'cancelled' : 'finished',
      });
    }
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,

    start: (pages: readonly ImportPage[], profile: CorrectionProfile): Promise<void> => {
      if (active !== null) return Promise.resolve();
      if (state.profile !== null && state.profile.id !== profile.id) {
        commit({ ...state, pages: {} });
      }
      const targets = pages.filter((page) => !isCurrent(page));
      if (targets.length === 0) {
        commit({ ...state, profile, outcome: 'finished' });
        return Promise.resolve();
      }
      return process(targets, profile, () => {
        transcription.start();
      });
    },

    retry: (page: ImportPage, options: { readonly recognize?: boolean } = {}): Promise<void> => {
      const profile = state.profile;
      if (active !== null || profile === null || state.pages[page.id] === undefined) {
        return Promise.resolve();
      }
      return process([page], profile, () => {
        const entry = transcription.getState().entries[page.id];
        if (options.recognize === true || entry === undefined || needsRecognition(entry, page)) {
          transcription.enqueue(page.id);
        }
      });
    },

    setHint: (id: string, index: number, status: HintStatus) => {
      const result = state.pages[id]?.result;
      const hint = result?.hints[index];
      if (result == null || hint === undefined || hint.status === status) return;
      const hints = result.hints.map((entry, position) =>
        position === index ? { ...entry, status } : entry,
      );
      patch(id, { result: withHints({ ...result, hints }) });
    },

    setCorrector: (next: Corrector | null, isPreview = false) => {
      corrector = next;
      preview = next !== null && isPreview;
    },

    cancel: () => {
      if (active === null || active.signal.aborted) return;
      commit({ ...state, stopping: true });
      active.abort();
      if (state.run?.phase === 'transcribing') transcription.cancel();
    },

    prune: (present: ReadonlySet<string>) => {
      const removed = Object.keys(state.pages).filter((id) => !present.has(id));
      if (removed.length === 0) return;
      const pages = { ...state.pages };
      for (const id of removed) delete pages[id];
      commit({ ...state, pages });
    },

    dispose: () => {
      active?.abort();
      commit({ ...state, pages: {} });
    },
  };
}

export type ReviewFlow = ReturnType<typeof createReviewFlow>;
