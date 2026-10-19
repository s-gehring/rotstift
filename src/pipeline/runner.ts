import type { ImportPage, Rotation } from '../import/pages.ts';
import type { PageTranscriber, TranscribeError, TranscribeResult } from './transcriber.ts';

export type PageStatus = 'waiting' | 'running' | 'done' | 'error';

export interface PageEntry {
  readonly status: PageStatus;
  readonly text: string;
  readonly edited: boolean;
  readonly rotation: Rotation;
  readonly error: TranscribeError | null;
  readonly previous: PageEntry | null;
}

export interface Batch {
  readonly total: number;
  readonly finished: number;
}

export interface RunState {
  readonly entries: Readonly<Record<string, PageEntry>>;
  readonly batch: Batch | null;
  readonly durationsMs: readonly number[];
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

const EMPTY: RunState = { entries: {}, batch: null, durationsMs: [] };

const isQueued = (entry: PageEntry) => entry.status === 'waiting' || entry.status === 'running';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isOutdated(entry: PageEntry, page: Pick<ImportPage, 'rotation'>): boolean {
  return (entry.status === 'done' || entry.status === 'error') && entry.rotation !== page.rotation;
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

  const patchEntry = (id: string, patch: Partial<PageEntry>) => {
    const entry = state.entries[id];
    if (entry === undefined) return;
    commit({ ...state, entries: { ...state.entries, [id]: { ...entry, ...patch } } });
  };

  const enqueue = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const entries = { ...state.entries };
    for (const id of ids) {
      const page = pages.find((candidate) => candidate.id === id);
      if (page === undefined) continue;
      entries[id] = {
        status: 'waiting',
        text: '',
        edited: false,
        rotation: page.rotation,
        error: null,
        previous: state.entries[id] ?? null,
      };
    }
    commit({
      ...state,
      entries,
      batch: {
        total: (state.batch?.total ?? 0) + ids.length,
        finished: state.batch?.finished ?? 0,
      },
    });
  };

  const attempt = async (
    active: PageTranscriber,
    page: ImportPage,
    signal: AbortSignal,
  ): Promise<TranscribeResult> => {
    try {
      const png = await deps.render(page);
      signal.throwIfAborted();
      return await active.transcribe(png, signal);
    } catch (error) {
      if (signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
      return { ok: false, error: { kind: 'failed', message: errorMessage(error) } };
    }
  };

  const runPage = async (active: PageTranscriber, page: ImportPage) => {
    const run: Current = {
      id: page.id,
      rotation: page.rotation,
      abort: new AbortController(),
      reason: undefined,
    };
    current = run;
    patchEntry(page.id, { status: 'running', rotation: page.rotation, error: null });
    const started = now();
    const result = await attempt(active, page, run.abort.signal);
    current = null;
    if (run.reason !== undefined) return;
    const entry = state.entries[page.id];
    if (entry === undefined) return;
    const settled: PageEntry = result.ok
      ? {
          ...entry,
          status: 'done',
          text: result.lines.join('\n'),
          edited: false,
          error: null,
          previous: null,
        }
      : { ...entry, status: 'error', text: '', edited: false, error: result.error, previous: null };
    const batch = state.batch;
    commit({
      entries: { ...state.entries, [page.id]: settled },
      batch: batch && { ...batch, finished: batch.finished + 1 },
      durationsMs: result.ok ? [...state.durationsMs, now() - started] : state.durationsMs,
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
      commit({ ...state, batch: null });
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
        patchEntry(page.id, { status: 'waiting', rotation: page.rotation });
      }
    },

    start: () => {
      if (transcriber === null) return;
      enqueue(
        pages
          .filter((page) => {
            const entry = state.entries[page.id];
            return (
              entry === undefined ||
              entry.status === 'error' ||
              (isOutdated(entry, page) && !entry.edited)
            );
          })
          .map((page) => page.id),
      );
      void pump();
    },

    retry: (id: string) => {
      const entry = state.entries[id];
      if (transcriber === null || entry === undefined || isQueued(entry)) return;
      enqueue([id]);
      void pump();
    },

    cancel: () => {
      if (current !== null && current.reason === undefined) {
        current.reason = 'cancel';
        current.abort.abort();
      }
      const entries = { ...state.entries };
      for (const [id, entry] of Object.entries(entries)) {
        if (!isQueued(entry)) continue;
        if (entry.previous === null) delete entries[id];
        else entries[id] = entry.previous;
      }
      commit({ ...state, entries, batch: null });
    },

    edit: (id: string, text: string) => {
      if (state.entries[id]?.status !== 'done') return;
      patchEntry(id, { text, edited: true });
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;
