import type { PagePhase } from './transcriber.ts';

export const WATCHDOG = {
  floorMs: 300_000,
  ceilingMs: 600_000,
  startupLimitMs: 330_000,
  queueLimitMs: 1_800_000,
  factor: 4,
  minSamples: 3,
} as const;

export function median(values: readonly number[]): number {
  const sorted = values.reduce<number[]>((acc, value) => {
    const at = acc.findIndex((other) => other > value);
    acc.splice(at === -1 ? acc.length : at, 0, value);
    return acc;
  }, []);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function pageLimitMs(durationsMs: readonly number[]): number {
  if (durationsMs.length < WATCHDOG.minSamples) return WATCHDOG.ceilingMs;
  const scaled = median(durationsMs) * WATCHDOG.factor;
  return Math.min(WATCHDOG.ceilingMs, Math.max(WATCHDOG.floorMs, scaled));
}

export function phaseLimitMs(
  phase: PagePhase,
  durationsMs: readonly number[],
  attemptNo = 1,
): number {
  if (phase === 'sidecar_start') return WATCHDOG.startupLimitMs;
  if (phase === 'queued') return WATCHDOG.queueLimitMs;
  return attemptNo > 1 ? WATCHDOG.ceilingMs : pageLimitMs(durationsMs);
}

export type PhaseTimings = Partial<Record<PagePhase, number>>;

export interface Stall {
  readonly phase: PagePhase;
  readonly limitMs: number;
  readonly elapsedMs: number;
}

export interface PhaseWatchOptions {
  readonly now: () => number;
  readonly limitFor: (phase: PagePhase) => number;
  readonly onStall: (stall: Stall) => void;
  readonly onPhase?: (phase: PagePhase, previous: PagePhase | null, previousMs: number) => void;
}

export function createPhaseWatch(options: PhaseWatchOptions) {
  const timings: PhaseTimings = {};
  let phase: PagePhase | null = null;
  let since = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const close = (at: number) => {
    if (phase === null) return 0;
    const spent = Math.max(0, at - since);
    timings[phase] = (timings[phase] ?? 0) + spent;
    return spent;
  };

  return {
    enter(next: PagePhase) {
      if (stopped) return;
      clearTimeout(timer);
      const at = options.now();
      const previous = phase;
      const spent = close(at);
      phase = next;
      since = at;
      options.onPhase?.(next, previous, spent);
      const limitMs = options.limitFor(next);
      timer = setTimeout(() => {
        if (stopped) return;
        stopped = true;
        options.onStall({ phase: next, limitMs, elapsedMs: Math.max(0, options.now() - since) });
      }, limitMs);
    },
    stop(): PhaseTimings {
      if (!stopped) close(options.now());
      stopped = true;
      clearTimeout(timer);
      return timings;
    },
    isStopped: () => stopped,
  };
}

export type PhaseWatch = ReturnType<typeof createPhaseWatch>;
