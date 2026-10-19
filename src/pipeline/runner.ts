import type { ImportPage, Rotation } from '../import/pages.ts';
import type { PageTranscriber, TranscribeError, TranscribeResult } from './transcriber.ts';

export type PageStatus = 'waiting' | 'running' | 'done' | 'error';

export interface PageEntry {
  readonly status: PageStatus;
  readonly text: string;
  readonly hasTranscript: boolean;
  readonly edited: boolean;
  readonly rotation: Rotation;
  readonly error: TranscribeError | null;
}

export interface Batch {
  readonly total: number;
  readonly finished: number;
}

export interface RunState {
  readonly entries: Readonly<Record<string, PageEntry>>;
  readonly batch: Batch | null;
  readonly durationsMs: readonly number[];
  readonly runningSince: number | null;
}

export interface RunnerDeps {
  readonly render: (page: ImportPage) => Promise<Blob>;
  readonly now?: () => number;
}

interface Current {
  readonly id: string;
  readonly rotation: Rotation;
  readonly abort: AbortController;
  reason: 'cancel' | 'removed' | 'rotated' | undefined;
}

export interface Startable {
  readonly queue: readonly ImportPage[];
  readonly skippedEdited: readonly ImportPage[];
}

const EMPTY: RunState = { entries: {}, batch: null, durationsMs: [], runningSince: null };

const CANCELLED: TranscribeResult = { ok: false, error: { kind: 'cancelled' } };

const isQueued = (entry: PageEntry) => entry.status === 'waiting' || entry.status === 'running';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isOutdated(entry: PageEntry, page: Pick<ImportPage, 'rotation'>): boolean {
  return (entry.status === 'done' || entry.status === 'error') && entry.rotation !== page.rotation;
}

export function startablePages(pages: readonly ImportPage[], state: RunState): Startable {
  const queue: ImportPage[] = [];
  const skippedEdited: ImportPage[] = [];
  for (const page of pages) {
    const entry = state.entries[page.id];
    if (entry === undefined || (entry.status === 'error' && !entry.hasTranscript)) {
      queue.push(page);
    } else if (isOutdated(entry, page)) {
      (entry.edited ? skippedEdited : queue).push(page);
    }
  }
  return { queue, skippedEdited };
}

function abortedResult(signal: AbortSignal): Promise<TranscribeResult> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(CANCELLED);
    else signal.addEventListener('abort', () => resolve(CANCELLED), { once: true });
  });
}

export function createRunner(deps: RunnerDeps) {
  const now = deps.now ?? (() => performance.now());
  const listeners = new Set<() => void>();
  let state: RunState = EMPTY;
  let pages: readonly ImportPage[] = [];
  let transcriber: PageTranscriber | null = null;
  let current: Current | null = null;
  let looping = false;

  const commit = (next: RunState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const patchEntry = (id: string, patch: Partial<PageEntry>, extra: Partial<RunState> = {}) => {
    const entry = state.entries[id];
    if (entry === undefined) return;
    commit({ ...state, ...extra, entries: { ...state.entries, [id]: { ...entry, ...patch } } });
  };

  const enqueue = (targets: readonly ImportPage[]) => {
    if (targets.length === 0) return;
    const entries = { ...state.entries };
    for (const page of targets) {
      const existing = entries[page.id];
      entries[page.id] = {
        status: 'waiting',
        text: existing?.text ?? '',
        hasTranscript: existing?.hasTranscript ?? false,
        edited: existing?.edited ?? false,
        rotation: existing?.hasTranscript ? existing.rotation : page.rotation,
        error: null,
      };
    }
    commit({
      ...state,
      entries,
      batch: {
        total: (state.batch?.total ?? 0) + targets.length,
        finished: state.batch?.finished ?? 0,
      },
    });
  };

  const attempt = async (
    active: PageTranscriber,
    page: ImportPage,
    signal: AbortSignal,
  ): Promise<TranscribeResult> => {
    const work = async (): Promise<TranscribeResult> => {
      try {
        const png = await deps.render(page);
        signal.throwIfAborted();
        return await active.transcribe(png, signal);
      } catch (error) {
        if (signal.aborted) return CANCELLED;
        return { ok: false, error: { kind: 'failed', message: errorMessage(error) } };
      }
    };
    return Promise.race([work(), abortedResult(signal)]);
  };

  const settle = (entry: PageEntry, run: Current, result: TranscribeResult): PageEntry => {
    if (result.ok) {
      return {
        status: 'done',
        text: result.lines.join('\n'),
        hasTranscript: true,
        edited: false,
        rotation: run.rotation,
        error: null,
      };
    }
    return entry.hasTranscript
      ? { ...entry, status: 'done', error: result.error }
      : { ...entry, status: 'error', rotation: run.rotation, error: result.error };
  };

  const runPage = async (active: PageTranscriber, page: ImportPage) => {
    const run: Current = {
      id: page.id,
      rotation: page.rotation,
      abort: new AbortController(),
      reason: undefined,
    };
    current = run;
    const started = now();
    patchEntry(page.id, { status: 'running', error: null }, { runningSince: started });
    const result = await attempt(active, page, run.abort.signal);
    if (current === run) current = null;
    if (run.reason !== undefined) return;
    const entry = state.entries[page.id];
    if (entry === undefined) return;
    const batch = state.batch;
    commit({
      ...state,
      entries: { ...state.entries, [page.id]: settle(entry, run, result) },
      batch: batch && { ...batch, finished: batch.finished + 1 },
      durationsMs: result.ok ? [...state.durationsMs, now() - started] : state.durationsMs,
      runningSince: null,
    });
  };

  const pump = async () => {
    const active = transcriber;
    if (looping || active === null) return;
    looping = true;
    try {
      for (;;) {
        const next = pages.find((page) => state.entries[page.id]?.status === 'waiting');
        if (next === undefined) break;
        await runPage(active, next);
      }
    } finally {
      looping = false;
      commit({ ...state, batch: null, runningSince: null });
    }
  };

  const dropQueued = (ids: ReadonlySet<string>) => {
    const entries = { ...state.entries };
    let removedQueued = 0;
    for (const id of ids) {
      const entry = entries[id];
      if (entry === undefined) continue;
      if (isQueued(entry)) removedQueued += 1;
      delete entries[id];
    }
    const batch = state.batch;
    commit({
      ...state,
      entries,
      batch: batch && { ...batch, total: Math.max(batch.finished, batch.total - removedQueued) },
    });
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,

    setTranscriber: (next: PageTranscriber | null) => {
      transcriber = next;
    },

    setPages: (next: readonly ImportPage[]) => {
      pages = next;
      const present = new Set(next.map((page) => page.id));
      const gone = new Set(Object.keys(state.entries).filter((id) => !present.has(id)));
      if (current !== null && gone.has(current.id)) {
        current.reason = 'removed';
        current.abort.abort();
      }
      if (gone.size > 0) dropQueued(gone);

      const running = current;
      const page = running && next.find((candidate) => candidate.id === running.id);
      if (running && page && running.reason === undefined && page.rotation !== running.rotation) {
        running.reason = 'rotated';
        running.abort.abort();
        patchEntry(page.id, { status: 'waiting' });
      }
    },

    start: () => {
      if (transcriber === null) return;
      enqueue(startablePages(pages, state).queue);
      void pump();
    },

    retry: (id: string) => {
      const entry = state.entries[id];
      const page = pages.find((candidate) => candidate.id === id);
      if (transcriber === null || entry === undefined || page === undefined || isQueued(entry)) {
        return;
      }
      enqueue([page]);
      void pump();
    },

    cancel: () => {
      if (current !== null && current.reason === undefined) {
        current.reason = 'cancel';
        current.abort.abort();
      }
      const entries: Record<string, PageEntry> = {};
      for (const [id, entry] of Object.entries(state.entries)) {
        if (!isQueued(entry)) entries[id] = entry;
        else if (entry.hasTranscript) entries[id] = { ...entry, status: 'done' };
      }
      commit({ ...state, entries, batch: null, runningSince: null });
    },

    edit: (id: string, text: string) => {
      if (state.entries[id]?.status !== 'done') return;
      patchEntry(id, { text, edited: true });
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;
