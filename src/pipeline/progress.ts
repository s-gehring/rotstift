import type { RunState } from './runner.ts';

export interface Progress {
  readonly current: number;
  readonly total: number;
  readonly remainingMs: number | null;
}

export function describeProgress(state: RunState, now: number): Progress | null {
  const { batch, durationsMs, runningSince } = state;
  if (batch === null) return null;
  const left = batch.total - batch.finished;
  let remainingMs: number | null = null;
  if (durationsMs.length > 0) {
    const average = durationsMs.reduce((sum, duration) => sum + duration, 0) / durationsMs.length;
    const elapsed = runningSince === null ? 0 : Math.max(0, now - runningSince);
    remainingMs = Math.max(average * Math.max(0, left - 1), average * left - elapsed);
  }
  return { current: Math.min(batch.finished + 1, batch.total), total: batch.total, remainingMs };
}

export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 10) return 'weniger als 10 Sekunden';
  if (seconds < 60) return `etwa ${Math.round(seconds / 5) * 5} Sekunden`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes === 1) return 'etwa 1 Minute';
  if (minutes < 60) return `etwa ${minutes} Minuten`;
  return `etwa ${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
}
