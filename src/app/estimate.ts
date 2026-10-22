import { z } from 'zod';

export type Step = 'read' | 'correct' | 'review';

export type Rates = Readonly<Record<Step, number>>;

export type Workload = Readonly<Record<Step, number>>;

export const DEFAULT_RATES: Rates = { read: 30, correct: 15, review: 20 };

export const NO_WORK: Workload = { read: 0, correct: 0, review: 0 };

const SMOOTHING = 0.3;

const MIN_RATE = 1;

const MAX_RATE = 600;

export const RATES_STORAGE_KEY = 'rotstift.step-rates';

export interface Snapshot {
  readonly step: Step;
  readonly left: Workload;
}

interface Mark {
  readonly step: Step;
  readonly left: number;
  readonly at: number;
  readonly fresh: boolean;
}

export interface Estimator {
  readonly rates: Rates;
  readonly mark: Mark | null;
}

export function createEstimator(rates: Rates = DEFAULT_RATES): Estimator {
  return { rates, mark: null };
}

export function endRun(estimator: Estimator): Estimator {
  return estimator.mark === null ? estimator : { ...estimator, mark: null };
}

function clampRate(seconds: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, seconds));
}

export function observe(estimator: Estimator, snapshot: Snapshot, now: number): Estimator {
  const { step } = snapshot;
  const left = snapshot.left[step];
  const { mark } = estimator;
  if (mark === null || mark.step !== step || left > mark.left) {
    return { ...estimator, mark: { step, left, at: now, fresh: true } };
  }
  if (left === mark.left) return estimator;
  const done = mark.left - left;
  const next: Mark = { step, left, at: now, fresh: false };
  if (mark.fresh) return { ...estimator, mark: next };
  const measured = clampRate((now - mark.at) / 1000 / done);
  const weight = 1 - (1 - SMOOTHING) ** done;
  const rate = estimator.rates[step] * (1 - weight) + measured * weight;
  return { rates: { ...estimator.rates, [step]: rate }, mark: next };
}

export function totalSeconds(rates: Rates, work: Workload): number {
  return rates.read * work.read + rates.correct * work.correct + rates.review * work.review;
}

export function remainingSeconds(estimator: Estimator, snapshot: Snapshot, now: number): number {
  const { step, left } = snapshot;
  const { rates, mark } = estimator;
  const total = totalSeconds(rates, left);
  if (left[step] === 0) return total;
  const elapsed = mark === null || mark.step !== step ? 0 : Math.max(0, now - mark.at) / 1000;
  return Math.max(total - rates[step], total - elapsed);
}

function formatDuration(seconds: number): string | null {
  if (seconds < 60) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function remainingText(seconds: number): string | null {
  const text = formatDuration(seconds);
  return text === null ? null : `noch etwa ${text}`;
}

export function durationText(seconds: number): string | null {
  const text = formatDuration(seconds);
  return text === null ? null : `etwa ${text}`;
}

export type RatesStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): RatesStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

const rate = z.number().finite().min(MIN_RATE);

const STORED_RATES = z.object({ read: rate, correct: rate, review: rate });

export function loadRates(storage: RatesStorage | null = defaultStorage()): Rates {
  try {
    const stored = STORED_RATES.safeParse(
      JSON.parse(storage?.getItem(RATES_STORAGE_KEY) ?? 'null'),
    );
    if (!stored.success) return DEFAULT_RATES;
    const { read, correct, review } = stored.data;
    return { read: clampRate(read), correct: clampRate(correct), review: clampRate(review) };
  } catch {
    return DEFAULT_RATES;
  }
}

export function saveRates(rates: Rates, storage: RatesStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(RATES_STORAGE_KEY, JSON.stringify(rates));
  } catch {
    return;
  }
}
