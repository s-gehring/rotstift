import { confirmReading } from '../correction/second-reading.ts';
import { editReading, type PageReading } from '../correction/uncertain-reading.ts';
import type { ImportPage, Rotation } from '../import/pages.ts';
import { browserDiagnostics, createHeartbeat, type PipelineDiagnostics } from './diagnostics.ts';
import type {
  EnginePhase,
  PagePhase,
  PageTranscriber,
  TranscribeError,
  TranscribeResult,
} from './transcriber.ts';
import { createPhaseWatch, phaseLimitMs, type PhaseTimings, type Stall } from './watchdog.ts';

export type PageStatus = 'waiting' | 'running' | 'done' | 'error';

export interface PageEntry {
  readonly status: PageStatus;
  readonly text: string;
  readonly hasTranscript: boolean;
  readonly edited: boolean;
  readonly rotation: Rotation;
  readonly error: TranscribeError | null;
  readonly reading: PageReading | null;
  readonly awaitingSecond?: boolean;
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
  readonly secondReading?: boolean;
}

export type ReadPass = 'first' | 'second';

export interface RunnerDeps {
  readonly render: (page: ImportPage) => Promise<Blob>;
  readonly now?: () => number;
  readonly diagnostics?: PipelineDiagnostics;
}

interface Current {
  readonly id: string;
  readonly rotation: Rotation;
  readonly pass: ReadPass;
  abort: AbortController;
  reason: 'cancel' | 'removed' | 'rotated' | undefined;
}

export interface Startable {
  readonly queue: readonly ImportPage[];
  readonly skippedEdited: readonly ImportPage[];
}

const EMPTY: RunState = { entries: {}, batch: null, durationsMs: [], runningSince: null };

const CANCELLED: TranscribeResult = { ok: false, error: { kind: 'cancelled' } };

const MAX_CRASHES_PER_BATCH = 2;

const MAX_ATTEMPTS = 2;

const STALL_ERROR: TranscribeError = {
  kind: 'failed',
  stalled: true,
  message:
    'Die Erkennung dieser Seite ist zweimal hängen geblieben und wurde abgebrochen. Die übrigen Seiten werden weiter bearbeitet. Einzelheiten stehen im Diagnoseprotokoll unter „Texterkennung verwalten“.',
};

const LOST_ERROR: TranscribeError = {
  kind: 'failed',
  message:
    'Die Erkennung dieser Seite wurde zweimal unerwartet abgebrochen. Die übrigen Seiten werden weiter bearbeitet. Bitte die Seite später erneut erkennen lassen.',
};

const STALL_LIMIT_ERROR: TranscribeError = {
  kind: 'failed',
  message:
    'Die Texterkennung ist in diesem Durchgang mehrfach hängen geblieben oder abgestürzt. Bitte andere Programme schließen und die übrigen Seiten erneut erkennen lassen. Einzelheiten stehen im Diagnoseprotokoll unter „Texterkennung verwalten“.',
};

const PHASE_ORDER: readonly PagePhase[] = [
  'rendering',
  'queued',
  'sidecar_start',
  'encoding',
  'request',
  'parsing',
];

const PHASE_FIELDS: Readonly<Record<PagePhase, string>> = {
  rendering: 'renderMs',
  queued: 'queueMs',
  sidecar_start: 'sidecarMs',
  encoding: 'encodeMs',
  request: 'requestMs',
  parsing: 'parseMs',
};

interface Attempt {
  readonly result: TranscribeResult;
  readonly stall: Stall | undefined;
  readonly timings: PhaseTimings;
}

function rounded(timings: PhaseTimings): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const phase of PHASE_ORDER) {
    const ms = timings[phase];
    if (ms !== undefined) fields[PHASE_FIELDS[phase]] = Math.round(ms);
  }
  return fields;
}

const wasInterrupted = (run: Current) => run.reason !== undefined;

const CRASH_LIMIT_ERROR: TranscribeError = {
  kind: 'failed',
  message:
    'Die Texterkennung wurde in diesem Durchgang mehrfach unerwartet beendet. Vermutlich reicht der freie Arbeitsspeicher nicht aus. Bitte andere Programme schließen und die übrigen Seiten erneut erkennen lassen.',
};

const isQueued = (entry: PageEntry) => entry.status === 'waiting' || entry.status === 'running';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isCounting(state: RunState): boolean {
  return state.batch !== null || Object.values(state.entries).some(isQueued);
}

export function isSwitchLocked(state: RunState, phase: EnginePhase): boolean {
  return isCounting(state) || phase === 'starting';
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
  const diagnostics = deps.diagnostics ?? browserDiagnostics();
  const heartbeat = createHeartbeat(diagnostics);
  let limitSamples: number[] = [];
  const listeners = new Set<() => void>();
  let state: RunState = EMPTY;
  let pages: readonly ImportPage[] = [];
  let transcriber: PageTranscriber | null = null;
  let current: Current | null = null;
  let looping = false;
  let disposed = false;
  const isDisposed = () => disposed;

  const commit = (next: RunState) => {
    if (disposed || next === state) return;
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
        reading: existing?.reading ?? null,
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
    run: Current,
    attemptNo: number,
  ): Promise<Attempt> => {
    const read =
      run.pass === 'second' ? active.secondRead?.bind(active) : active.transcribe.bind(active);
    const { signal } = run.abort;
    let stall: Stall | undefined;
    const watch = createPhaseWatch({
      now,
      limitFor: (phase) => phaseLimitMs(phase, limitSamples, attemptNo),
      onPhase: (phase, previous, previousMs) => {
        diagnostics.log('page_phase', {
          pageId: page.id,
          attempt: attemptNo,
          pass: run.pass,
          phase,
          ...(previous !== null && { previousMs: Math.round(previousMs) }),
        });
      },
      onStall: (found) => {
        stall = found;
        limitSamples.push(found.elapsedMs);
        diagnostics.log('page_stalled', {
          pageId: page.id,
          attempt: attemptNo,
          pass: run.pass,
          phase: found.phase,
          limitMs: Math.round(found.limitMs),
          elapsedMs: Math.round(found.elapsedMs),
        });
        run.abort.abort();
      },
    });
    const work = async (): Promise<TranscribeResult> => {
      try {
        watch.enter('rendering');
        const png = await deps.render(page);
        signal.throwIfAborted();
        if (read === undefined) return CANCELLED;
        return await read(png, signal, (phase) => {
          watch.enter(phase);
        });
      } catch (error) {
        if (signal.aborted) return CANCELLED;
        return { ok: false, error: { kind: 'failed', message: errorMessage(error) } };
      }
    };
    const result = await Promise.race([work(), abortedResult(signal)]);
    return { result, stall, timings: watch.stop() };
  };

  const settle = (
    entry: PageEntry,
    run: Current,
    result: TranscribeResult,
    secondReading: boolean,
  ): PageEntry => {
    if (result.ok) {
      return {
        status: 'done',
        text: result.lines.join('\n'),
        hasTranscript: true,
        edited: false,
        rotation: run.rotation,
        error: null,
        reading: result.reading ?? null,
        ...(secondReading && result.reading !== undefined && { awaitingSecond: true }),
      };
    }
    return entry.hasTranscript
      ? { ...entry, status: 'done', error: result.error }
      : { ...entry, status: 'error', rotation: run.rotation, error: result.error };
  };

  const runAttempts = async (
    active: PageTranscriber,
    page: ImportPage,
    run: Current,
  ): Promise<{ result: TranscribeResult | undefined; attemptStart: number }> => {
    let stalledBefore = false;
    for (let attemptNo = 1; ; attemptNo += 1) {
      const attemptStart = now();
      diagnostics.log('page_start', { pageId: page.id, attempt: attemptNo, pass: run.pass });
      const outcome = await attempt(active, page, run, attemptNo);
      if (wasInterrupted(run)) return { result: undefined, attemptStart };
      const lostRequest =
        !outcome.result.ok && outcome.result.error.kind === 'cancelled' && !outcome.stall;
      if (lostRequest) {
        diagnostics.log('unexpected_cancel', { pageId: page.id, attempt: attemptNo });
      }
      if (outcome.stall === undefined && !lostRequest) {
        diagnostics.log('page_done', {
          pageId: page.id,
          attempt: attemptNo,
          pass: run.pass,
          ok: outcome.result.ok,
          totalMs: Math.round(now() - attemptStart),
          ...rounded(outcome.timings),
        });
        return { result: outcome.result, attemptStart };
      }
      stalledBefore ||= outcome.stall !== undefined;
      const reason = stalledBefore ? 'stalled' : 'unexpected_cancel';
      const restart = outcome.stall?.phase === 'sidecar_start' || attemptNo >= MAX_ATTEMPTS;
      if (restart) {
        diagnostics.log('sidecar_recover', { pageId: page.id, reason });
        await active.recover?.().catch(() => undefined);
      }
      if (attemptNo >= MAX_ATTEMPTS) {
        diagnostics.log('page_failed', { pageId: page.id, reason });
        const error = stalledBefore ? STALL_ERROR : LOST_ERROR;
        return { result: { ok: false, error }, attemptStart };
      }
      diagnostics.log('page_retry', { pageId: page.id, attempt: attemptNo + 1, reason });
      if (wasInterrupted(run)) return { result: undefined, attemptStart };
      run.abort = new AbortController();
    }
  };

  const settleSecond = (id: string, result: TranscribeResult) => {
    const entry = state.entries[id];
    if (entry === undefined) return;
    const confirmable = result.ok && entry.reading !== null && !entry.edited;
    patchEntry(id, {
      awaitingSecond: false,
      ...(confirmable && { reading: confirmReading(entry.reading, result.lines) }),
    });
  };

  const skipSecond = () => {
    if (!Object.values(state.entries).some((entry) => entry.awaitingSecond === true)) return;
    const entries: Record<string, PageEntry> = {};
    for (const [id, entry] of Object.entries(state.entries)) {
      entries[id] = entry.awaitingSecond === true ? { ...entry, awaitingSecond: false } : entry;
    }
    commit({ ...state, entries });
  };

  const runPage = async (
    active: PageTranscriber,
    page: ImportPage,
    pass: ReadPass,
  ): Promise<TranscribeResult | undefined> => {
    const run: Current = {
      id: page.id,
      rotation: page.rotation,
      pass,
      abort: new AbortController(),
      reason: undefined,
    };
    current = run;
    if (pass === 'first') {
      patchEntry(page.id, { status: 'running', error: null }, { runningSince: now() });
    }
    const { result, attemptStart } = await runAttempts(active, page, run);
    if (current === run) current = null;
    if (pass === 'second') {
      if (result !== undefined && run.reason === undefined) settleSecond(page.id, result);
      return result;
    }
    if (result === undefined || run.reason !== undefined) return undefined;
    const entry = state.entries[page.id];
    if (entry === undefined) return undefined;
    const batch = state.batch;
    const duration = result.ok
      ? Math.max(0, now() - attemptStart - (result.startupMs ?? 0))
      : undefined;
    if (duration !== undefined) limitSamples.push(duration);
    commit({
      ...state,
      entries: {
        ...state.entries,
        [page.id]: settle(entry, run, result, active.secondRead !== undefined),
      },
      batch: batch && { ...batch, finished: batch.finished + 1 },
      durationsMs: duration === undefined ? state.durationsMs : [...state.durationsMs, duration],
      runningSince: null,
    });
    return result;
  };

  const failWaiting = (error: TranscribeError) => {
    const entries = { ...state.entries };
    let failed = 0;
    for (const [id, entry] of Object.entries(entries)) {
      if (entry.status !== 'waiting') continue;
      failed += 1;
      entries[id] = entry.hasTranscript
        ? { ...entry, status: 'done', error }
        : { ...entry, status: 'error', error };
    }
    const batch = state.batch;
    commit({
      ...state,
      entries,
      batch: batch && { ...batch, finished: batch.finished + failed },
    });
  };

  const pump = async () => {
    const active = transcriber;
    if (disposed || looping || active === null) return;
    looping = true;
    let crashes = 0;
    let lastIncident: 'crash' | 'stall' = 'crash';
    heartbeat.start();
    diagnostics.log('batch_start', { pages: state.batch?.total ?? 0 });
    try {
      for (;;) {
        const first = pages.find((page) => state.entries[page.id]?.status === 'waiting');
        const next = first ?? pages.find((page) => state.entries[page.id]?.awaitingSecond === true);
        if (isDisposed() || next === undefined) break;
        const pass: ReadPass = first === undefined ? 'second' : 'first';
        const result = await runPage(active, next, pass);
        if (pass === 'second' && state.entries[next.id]?.awaitingSecond === true) {
          patchEntry(next.id, { awaitingSecond: false });
        }
        if (result && !result.ok && result.error.kind === 'failed') {
          const { crashed, stalled } = result.error;
          if (crashed || stalled) {
            crashes += 1;
            lastIncident = crashed ? 'crash' : 'stall';
            if (crashes >= MAX_CRASHES_PER_BATCH) {
              failWaiting(lastIncident === 'crash' ? CRASH_LIMIT_ERROR : STALL_LIMIT_ERROR);
              break;
            }
          }
        }
      }
    } finally {
      looping = false;
      skipSecond();
      diagnostics.log('batch_end', { pages: state.batch?.finished ?? 0 });
      heartbeat.stop();
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
      if (next !== transcriber) {
        limitSamples = [];
        if (state.durationsMs.length > 0) commit({ ...state, durationsMs: [] });
      }
      transcriber = next;
      const secondReading = next?.secondRead !== undefined;
      if ((state.secondReading ?? false) !== secondReading) commit({ ...state, secondReading });
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
        patchEntry(page.id, { status: 'waiting', awaitingSecond: false });
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

    enqueue: (id: string) => {
      const entry = state.entries[id];
      const page = pages.find((candidate) => candidate.id === id);
      if (transcriber === null || page === undefined || (entry && isQueued(entry))) return;
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
        if (!isQueued(entry))
          entries[id] = entry.awaitingSecond ? { ...entry, awaitingSecond: false } : entry;
        else if (entry.hasTranscript) entries[id] = { ...entry, status: 'done' };
      }
      commit({ ...state, entries, batch: null, runningSince: null });
    },

    dispose: () => {
      if (disposed) return;
      if (current !== null && current.reason === undefined) {
        current.reason = 'cancel';
        current.abort.abort();
      }
      disposed = true;
      heartbeat.stop();
      listeners.clear();
    },

    edit: (id: string, text: string) => {
      const entry = state.entries[id];
      if (entry?.status !== 'done') return;
      const reading = editReading(entry.reading, entry.text.split('\n'), text.split('\n'));
      patchEntry(id, { text, edited: true, reading });
    },
  };
}

export type Runner = ReturnType<typeof createRunner>;
