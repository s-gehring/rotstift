import type { RunState } from './runner.ts';

export interface Progress {
  readonly current: number;
  readonly total: number;
  readonly remainingMs: number | null;
}

export function describeProgress(state: RunState): Progress | null {
  const { batch, durationsMs } = state;
  if (batch === null) return null;
  const average =
    durationsMs.length === 0
      ? null
      : durationsMs.reduce((sum, duration) => sum + duration, 0) / durationsMs.length;
  return {
    current: Math.min(batch.finished + 1, batch.total),
    total: batch.total,
    remainingMs: average === null ? null : average * (batch.total - batch.finished),
  };
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
