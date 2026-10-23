import { z } from 'zod';
import { DEFAULT_CORRECTOR_ID, DEFAULT_MODEL_ID, DEFAULT_REVIEWER_ID } from '../models/registry.ts';
import type { StepCosts } from '../models/speed.ts';

export type Step = 'read' | 'confirm' | 'detect' | 'correct' | 'review';

export type Rates = Readonly<Record<Step, number>>;

export type Workload = Readonly<Record<Step, number>>;

export const DEFAULT_RATES: Rates = { read: 30, confirm: 30, detect: 15, correct: 15, review: 20 };

export const NO_WORK: Workload = { read: 0, confirm: 0, detect: 0, correct: 0, review: 0 };

const SMOOTHING = 0.3;

const MIN_RATE = 1;

const MAX_RATE = 6 * 60 * 60;

export const RATES_STORAGE_KEY = 'rotstift.model-rates';

export const LEGACY_RATES_STORAGE_KEY = 'rotstift.step-rates';

export type LearnedRates = Readonly<Record<string, number>>;

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
  return (
    rates.read * work.read +
    rates.confirm * work.confirm +
    rates.detect * work.detect +
    rates.correct * work.correct +
    rates.review * work.review
  );
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
  if (minutes >= 5 * 60) return `${Math.round(minutes / 60)} h`;
  const rest = minutes % 60;
  const hours = `${Math.floor(minutes / 60)} h`;
  return rest === 0 ? hours : `${hours} ${rest} min`;
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

const STORED_RATES = z.record(z.string(), rate);

const LEGACY_RATES = z.object({ read: rate, correct: rate, review: rate });

const STEPS: readonly Step[] = ['read', 'confirm', 'detect', 'correct', 'review'];

const rateKey = (step: Step, key: string) => `${step}:${key}`;

export function ratesFor(learned: LearnedRates, costs: StepCosts): Rates {
  const rateOf = (step: Step) =>
    learned[rateKey(step, costs[step].key)] ?? clampRate(DEFAULT_RATES[step] * costs[step].factor);
  return {
    read: rateOf('read'),
    confirm: rateOf('confirm'),
    detect: rateOf('detect'),
    correct: rateOf('correct'),
    review: rateOf('review'),
  };
}

export function learn(learned: LearnedRates, costs: StepCosts, rates: Rates): LearnedRates {
  const known = ratesFor(learned, costs);
  const changed = STEPS.filter((step) => rates[step] !== known[step]);
  if (changed.length === 0) return learned;
  return Object.fromEntries([
    ...Object.entries(learned),
    ...changed.map((step) => [rateKey(step, costs[step].key), rates[step]] as const),
  ]);
}

function parse(storage: RatesStorage | null, key: string): unknown {
  return JSON.parse(storage?.getItem(key) ?? 'null');
}

function clampAll(learned: LearnedRates): LearnedRates {
  return Object.fromEntries(Object.entries(learned).map(([key, value]) => [key, clampRate(value)]));
}

export function loadRates(storage: RatesStorage | null = defaultStorage()): LearnedRates {
  try {
    const stored = STORED_RATES.safeParse(parse(storage, RATES_STORAGE_KEY));
    if (stored.success) return clampAll(stored.data);
    const legacy = LEGACY_RATES.safeParse(parse(storage, LEGACY_RATES_STORAGE_KEY));
    if (!legacy.success) return {};
    const { read, correct, review } = legacy.data;
    return clampAll({
      [rateKey('read', DEFAULT_MODEL_ID)]: read,
      [rateKey('correct', DEFAULT_CORRECTOR_ID)]: correct,
      [rateKey('review', DEFAULT_REVIEWER_ID)]: review,
    });
  } catch {
    return {};
  }
}

export function saveRates(
  learned: LearnedRates,
  storage: RatesStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(RATES_STORAGE_KEY, JSON.stringify(learned));
  } catch {
    return;
  }
}
