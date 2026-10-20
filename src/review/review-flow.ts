import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Bbox, Transcript } from '../annotations/transcript.ts';
import { correctPage, type CorrectPageResult } from '../correction/correct-page.ts';
import { describeCorrectError, type Corrector } from '../correction/corrector.ts';
import type { ImportPage, Rotation } from '../import/pages.ts';
import type { LayoutLocator } from '../layout/layout-client.ts';
import type { LayoutResult } from '../layout/types.ts';
import type { Runner } from '../pipeline/runner.ts';
import { describeError } from '../pipeline/transcriber.ts';
import type { Statistics } from '../stats/statistics.ts';

export interface PageImage {
  readonly blob: Blob;
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export type ReviewPhase = 'transcribing' | 'locating' | 'correcting';

export type ReviewStatus =
  'waiting' | ReviewPhase | 'done' | 'empty' | 'unreadable' | 'failed' | 'cancelled';

export interface CorrectedPage {
  readonly transcript: Transcript;
  readonly statistics: Statistics;
  readonly droppedMarks: number;
  readonly unplacedLines: readonly number[];
}

export interface ReviewPage {
  readonly status: ReviewStatus;
  readonly rotation: Rotation;
  readonly source: string | null;
  readonly image: PageImage | null;
  readonly bboxes: readonly (Bbox | undefined)[] | null;
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
  readonly outcome: 'finished' | 'cancelled' | null;
}

export type TranscriptionSource = Pick<
  Runner,
  'start' | 'retry' | 'cancel' | 'getState' | 'subscribe'
>;

export interface ReviewDeps {
  readonly transcription: TranscriptionSource;
  readonly locator: Pick<LayoutLocator, 'locate'>;
  readonly loadImage: (page: ImportPage) => Promise<PageImage>;
  readonly releaseImage?: (image: PageImage) => void;
}

export const CORRECTOR_MISSING =
  'Das Korrekturmodell fehlt. Bitte zuerst das Korrekturmodell einrichten.';

const UNREADABLE = 'Die Seite wurde nicht erkannt.';

const EMPTY: ReviewState = { pages: {}, profile: null, run: null, outcome: null };

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
    return { x: Math.max(0, x), y: Math.max(0, y), width, height };
  });
}

function unplacedLines(transcript: Transcript): number[] {
  return transcript.lines
    .filter((line) => line.bbox === undefined && line.marks.length > 0)
    .map((line) => line.number);
}

function blankPage(rotation: Rotation): ReviewPage {
  return {
    status: 'waiting',
    rotation,
    source: null,
    image: null,
    bboxes: null,
    result: null,
    message: null,
    detail: null,
  };
}

export function isRunning(state: ReviewState): boolean {
  return state.run !== null;
}

export function createReviewFlow(deps: ReviewDeps) {
  const { transcription } = deps;
  const listeners = new Set<() => void>();
  let state: ReviewState = EMPTY;
  let active: AbortController | null = null;
  let corrector: Corrector | null = null;

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

  const release = (image: PageImage | null) => {
    if (image !== null) deps.releaseImage?.(image);
  };

  const transcriptText = (id: string): string | null => {
    const entry = transcription.getState().entries[id];
    return entry?.hasTranscript ? entry.text : null;
  };

  const isCurrent = (page: ImportPage): boolean => {
    const existing = state.pages[page.id];
    return (
      existing !== undefined &&
      (existing.status === 'done' || existing.status === 'empty') &&
      existing.rotation === page.rotation &&
      existing.source === transcriptText(page.id)
    );
  };

  const untilSettled = (): Promise<void> =>
    new Promise((resolve) => {
      if (transcription.getState().batch === null) {
        resolve();
        return;
      }
      const unsubscribe = transcription.subscribe(() => {
        if (transcription.getState().batch === null) {
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
      await untilSettled();
    } finally {
      unsubscribe();
    }
  };

  const collectTranscripts = (targets: readonly ImportPage[]): Readable[] => {
    const entries = transcription.getState().entries;
    const readable: Readable[] = [];
    for (const page of targets) {
      const entry = entries[page.id];
      if (entry === undefined || !entry.hasTranscript) {
        patch(page.id, {
          status: 'unreadable',
          message: entry?.error ? describeError(entry.error) : UNREADABLE,
          detail: null,
        });
        continue;
      }
      const lines = entry.text.split('\n');
      const previous = state.pages[page.id];
      const sameSource = previous?.source === entry.text && previous.rotation === page.rotation;
      if (!sameSource && previous !== undefined) {
        release(previous.image);
        patch(page.id, { image: null, bboxes: null });
      }
      patch(page.id, { source: entry.text, rotation: page.rotation, result: null });
      if (lines.every((line) => line.trim() === '')) {
        patch(page.id, { status: 'empty', message: null, detail: null });
        continue;
      }
      readable.push({ page, lines });
    }
    return readable;
  };

  const locatePhase = async (readable: readonly Readable[], signal: AbortSignal) => {
    let finished = 0;
    setRun({ phase: 'locating', total: readable.length, finished });
    for (const { page, lines } of readable) {
      const existing = state.pages[page.id];
      if (existing?.image === null || existing?.bboxes === null) {
        patch(page.id, { status: 'locating' });
        const loading = deps.loadImage(page);
        const image = await abortable(loading, signal).catch(() => null);
        if (image === ABORTED) {
          loading.then(release, () => undefined);
          return;
        }
        let bboxes: (Bbox | undefined)[] = lines.map(() => undefined);
        if (image !== null) {
          const layout = await abortable(deps.locator.locate(image.blob, lines), signal).catch(
            () => null,
          );
          if (layout === ABORTED) {
            release(image);
            return;
          }
          if (layout !== null) bboxes = toBboxes(layout, lines.length);
        }
        patch(page.id, { status: 'waiting', image, bboxes });
      }
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
    setRun({ phase: 'correcting', total: readable.length, finished });
    for (const { page, lines } of readable) {
      if (signal.aborted) return;
      if (corrector === null) {
        patch(page.id, { status: 'failed', message: CORRECTOR_MISSING, detail: null });
      } else {
        patch(page.id, { status: 'correcting', message: null, detail: null });
        const bboxes = state.pages[page.id]?.bboxes ?? undefined;
        const result = await abortable(
          correctPage({ lines, profile, corrector, signal, ...(bboxes && { bboxes }) }),
          signal,
        ).catch((error: unknown): CorrectPageResult => ({
          ok: false,
          error: { kind: 'failed', message: String(error) },
        }));
        if (result === ABORTED) return;
        if (result.ok) {
          patch(page.id, {
            status: 'done',
            result: {
              transcript: result.transcript,
              statistics: result.statistics,
              droppedMarks: result.droppedMarks,
              unplacedLines: unplacedLines(result.transcript),
            },
          });
        } else if (result.error.kind === 'cancelled') {
          patch(page.id, { status: 'cancelled' });
        } else {
          patch(page.id, {
            status: 'failed',
            message: describeCorrectError(result.error),
            detail: result.error.kind === 'failed' ? (result.error.detail ?? null) : null,
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
    commit({ ...state, pages, profile, outcome: null });
    try {
      await transcribePhase(targets, begin);
      if (aborted()) return;
      const readable = collectTranscripts(targets);
      await locatePhase(readable, abort.signal);
      if (aborted()) return;
      await correctPhase(readable, profile, abort.signal);
    } finally {
      const cancelled = abort.signal.aborted;
      if (cancelled) {
        const next = { ...state.pages };
        for (const page of targets) {
          const entry = next[page.id];
          if (entry !== undefined && ACTIVE.has(entry.status)) {
            next[page.id] = { ...entry, status: 'cancelled' };
          }
        }
        commit({ ...state, pages: next });
      }
      if (active === abort) active = null;
      commit({ ...state, run: null, outcome: cancelled ? 'cancelled' : 'finished' });
    }
  };

  const reset = () => {
    for (const page of Object.values(state.pages)) release(page.image);
    commit({ ...state, pages: {} });
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,

    start: (pages: readonly ImportPage[], profile: CorrectionProfile): Promise<void> => {
      if (active !== null) return Promise.resolve();
      if (state.profile !== null && state.profile.id !== profile.id) reset();
      const targets = pages.filter((page) => !isCurrent(page));
      if (targets.length === 0) {
        commit({ ...state, profile, outcome: 'finished' });
        return Promise.resolve();
      }
      return process(targets, profile, () => {
        transcription.start();
      });
    },

    retry: (page: ImportPage): Promise<void> => {
      const profile = state.profile;
      if (active !== null || profile === null || state.pages[page.id] === undefined) {
        return Promise.resolve();
      }
      return process([page], profile, () => {
        const entry = transcription.getState().entries[page.id];
        if (entry === undefined) transcription.start();
        else if (!entry.hasTranscript) transcription.retry(page.id);
      });
    },

    setCorrector: (next: Corrector | null) => {
      corrector = next;
    },

    cancel: () => {
      if (active === null || active.signal.aborted) return;
      active.abort();
      if (state.run?.phase === 'transcribing') transcription.cancel();
    },

    prune: (present: ReadonlySet<string>) => {
      const removed = Object.keys(state.pages).filter((id) => !present.has(id));
      if (removed.length === 0) return;
      const pages = { ...state.pages };
      for (const id of removed) {
        release(pages[id]?.image ?? null);
        delete pages[id];
      }
      commit({ ...state, pages });
    },

    dispose: () => {
      active?.abort();
      reset();
    },
  };
}

export type ReviewFlow = ReturnType<typeof createReviewFlow>;
