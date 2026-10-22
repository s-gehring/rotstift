import { describe, expect, it } from 'vitest';
import {
  createEstimator,
  DEFAULT_RATES,
  durationText,
  endRun,
  loadRates,
  NO_WORK,
  observe,
  RATES_STORAGE_KEY,
  remainingSeconds,
  remainingText,
  saveRates,
  totalSeconds,
  type RatesStorage,
  type Snapshot,
} from './estimate.ts';

const reading = (read: number): Snapshot => ({
  step: 'read',
  left: { read, correct: read, review: 0 },
});

const correcting = (correct: number): Snapshot => ({
  step: 'correct',
  left: { ...NO_WORK, correct },
});

function memory(initial: string | null = null): RatesStorage & { value: string | null } {
  const store = {
    value: initial,
    getItem: () => store.value,
    setItem: (_key: string, value: string) => {
      store.value = value;
    },
  };
  return store;
}

describe('start value', () => {
  it('uses 30 s per page for reading, 15 s per page for correcting and 20 s per work', () => {
    const estimator = createEstimator();
    const snapshot: Snapshot = { step: 'read', left: { read: 20, correct: 20, review: 10 } };
    expect(totalSeconds(estimator.rates, snapshot.left)).toBe(1100);
    expect(remainingSeconds(estimator, snapshot, 0)).toBe(1100);
    expect(remainingText(1100)).toBe('noch etwa 18 min');
  });

  it('subtracts the time already spent on the current unit but keeps the units behind it', () => {
    const marked = observe(createEstimator(), reading(2), 0);
    expect(remainingSeconds(marked, reading(2), 20_000)).toBe(70);
    expect(remainingSeconds(marked, reading(2), 90_000)).toBe(60);
  });
});

describe('only the chosen steps and open pages count', () => {
  it('ignores steps without work', () => {
    const estimator = createEstimator();
    const onlyReading: Snapshot = { step: 'read', left: { ...NO_WORK, read: 4 } };
    expect(remainingSeconds(estimator, onlyReading, 0)).toBe(120);
    expect(remainingSeconds(estimator, correcting(0), 0)).toBe(0);
  });

  it('shrinks with every finished unit', () => {
    const estimator = createEstimator();
    expect(remainingSeconds(estimator, reading(4), 0)).toBeGreaterThan(
      remainingSeconds(estimator, reading(3), 0),
    );
  });
});

describe('learning from the run', () => {
  it('skips the first unit of a step because it includes loading the model', () => {
    let estimator = observe(createEstimator(), correcting(4), 0);
    estimator = observe(estimator, correcting(3), 120_000);
    expect(estimator.rates).toEqual(DEFAULT_RATES);
  });

  it('moves the rate part of the way towards the measured time', () => {
    let estimator = observe(createEstimator(), correcting(4), 0);
    estimator = observe(estimator, correcting(3), 10_000);
    estimator = observe(estimator, correcting(2), 40_000);
    expect(estimator.rates.correct).toBeCloseTo(15 * 0.7 + 30 * 0.3);
    expect(estimator.rates.read).toBe(DEFAULT_RATES.read);
  });

  it('converges on a steady machine without jumping', () => {
    let estimator = observe(createEstimator(), reading(12), 0);
    let at = 0;
    const steps: number[] = [];
    for (let left = 11; left >= 0; left -= 1) {
      at += 60_000;
      estimator = observe(estimator, reading(left), at);
      steps.push(estimator.rates.read);
    }
    expect(steps[0]).toBe(DEFAULT_RATES.read);
    for (let index = 1; index < steps.length; index += 1) {
      const change = (steps[index] ?? 0) - (steps[index - 1] ?? 0);
      expect(change).toBeGreaterThan(0);
      expect(change).toBeLessThanOrEqual(10);
    }
    expect(steps.at(-1)).toBeGreaterThan(50);
  });

  it('weights several units finished at once', () => {
    let estimator = observe(createEstimator(), correcting(6), 0);
    estimator = observe(estimator, correcting(5), 15_000);
    estimator = observe(estimator, correcting(2), 15_000 + 3 * 45_000);
    expect(estimator.rates.correct).toBeCloseTo(15 * 0.7 ** 3 + 45 * (1 - 0.7 ** 3));
  });

  it('starts a fresh interval when the next step begins', () => {
    let estimator = observe(createEstimator(), reading(2), 0);
    estimator = observe(estimator, reading(1), 30_000);
    estimator = observe(estimator, correcting(2), 200_000);
    estimator = observe(estimator, correcting(1), 400_000);
    expect(estimator.rates.correct).toBe(DEFAULT_RATES.correct);
    expect(estimator.mark?.step).toBe('correct');
  });

  it('restarts when work comes back', () => {
    let estimator = observe(createEstimator(), correcting(2), 0);
    estimator = observe(estimator, correcting(3), 100_000);
    expect(estimator.rates).toEqual(DEFAULT_RATES);
    expect(estimator.mark).toMatchObject({ left: 3, at: 100_000, fresh: true });
  });

  it('keeps the object while nothing finishes', () => {
    const marked = observe(createEstimator(), correcting(2), 0);
    expect(observe(marked, correcting(2), 5_000)).toBe(marked);
  });
});

describe('cancellation', () => {
  it('forgets the running interval but keeps what was learned', () => {
    let estimator = observe(createEstimator(), correcting(4), 0);
    estimator = observe(estimator, correcting(3), 10_000);
    estimator = observe(estimator, correcting(2), 40_000);
    const learned = estimator.rates;
    const ended = endRun(estimator);
    expect(ended.mark).toBeNull();
    expect(ended.rates).toBe(learned);
    expect(endRun(ended)).toBe(ended);
  });

  it('does not learn from the unit that was cut short', () => {
    let estimator = observe(createEstimator(), correcting(4), 0);
    estimator = observe(estimator, correcting(3), 10_000);
    estimator = endRun(estimator);
    estimator = observe(estimator, correcting(3), 1_000_000);
    estimator = observe(estimator, correcting(2), 1_010_000);
    expect(estimator.rates).toEqual(DEFAULT_RATES);
  });
});

describe('texts', () => {
  it.each([
    [0, null],
    [59, null],
    [60, 'noch etwa 1 min'],
    [89, 'noch etwa 1 min'],
    [12 * 60, 'noch etwa 12 min'],
    [75 * 60, 'noch etwa 1 h 15 min'],
  ])('remaining %i s', (seconds, expected) => {
    expect(remainingText(seconds)).toBe(expected);
  });

  it('names the duration before the start', () => {
    expect(durationText(20 * 60)).toBe('etwa 20 min');
    expect(durationText(40)).toBeNull();
  });
});

describe('stored rates', () => {
  it('stores numbers only and reads them back', () => {
    const storage = memory();
    const rates = { read: 52.5, correct: 11, review: 33 };
    saveRates(rates, storage);
    expect(storage.value).toBe(JSON.stringify(rates));
    expect(loadRates(storage)).toEqual(rates);
  });

  it.each([null, 'nonsense', '{"read":1}', '{"read":"a","correct":1,"review":1}', '[1,2,3]'])(
    'falls back to the rule of thumb for %s',
    (value) => {
      expect(loadRates(memory(value))).toEqual(DEFAULT_RATES);
    },
  );

  it('limits absurd values and survives missing or broken storage', () => {
    const wild = memory(JSON.stringify({ read: 99_999, correct: 15, review: 20 }));
    expect(loadRates(wild).read).toBe(600);
    expect(loadRates(null)).toEqual(DEFAULT_RATES);
    const broken: RatesStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadRates(broken)).toEqual(DEFAULT_RATES);
    expect(() => saveRates(DEFAULT_RATES, broken)).not.toThrow();
    expect(RATES_STORAGE_KEY).toBe('rotstift.step-rates');
  });

  it('seeds the next run', () => {
    const storage = memory(JSON.stringify({ read: 60, correct: 30, review: 40 }));
    const estimator = createEstimator(loadRates(storage));
    expect(remainingSeconds(estimator, reading(2), 0)).toBe(2 * 60 + 2 * 30);
  });
});
