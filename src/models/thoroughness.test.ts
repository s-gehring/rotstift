import { describe, expect, it } from 'vitest';
import { ALL_MODELS, SECOND_READER_ID } from './registry.ts';
import {
  LEVELS,
  levelExceedsMemory,
  levelModels,
  loadSecondReading,
  saveSecondReading,
  SECOND_READING_STORAGE_KEY,
  THOROUGHNESS,
  thoroughnessOf,
} from './thoroughness.ts';

const GIB = 1024 ** 3;

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
};

const exceeding = (gib: number | null) =>
  THOROUGHNESS.filter((level) => levelExceedsMemory(level, gib === null ? null : gib * GIB));

describe('thoroughness levels', () => {
  it('maps every level to pinned models of the registry', () => {
    const ids = new Set(ALL_MODELS.map((model) => model.id));
    for (const level of THOROUGHNESS) {
      const { transcriber, corrector, reviewer } = LEVELS[level];
      expect([transcriber, corrector, reviewer].every((id) => ids.has(id))).toBe(true);
    }
    expect(ids.has(SECOND_READER_ID)).toBe(true);
  });

  it('keeps the recognition and the content and form step on Gemma 4 E2B in every level', () => {
    expect(LEVELS.fast).toEqual({
      transcriber: 'glm-ocr-q8',
      corrector: 'gemma-4-e2b-q4',
      reviewer: 'gemma-4-e2b-q4',
      secondReading: false,
    });
    expect(LEVELS.thorough).toEqual({
      transcriber: 'glm-ocr-q8',
      corrector: 'gemma-4-e4b-q4',
      reviewer: 'gemma-4-e2b-q4',
      secondReading: true,
    });
    expect(LEVELS.veryThorough).toEqual({
      transcriber: 'glm-ocr-q8',
      corrector: 'gemma-4-26b-a4b-q4',
      reviewer: 'gemma-4-e2b-q4',
      secondReading: true,
    });
  });

  it('recognizes a level only from the exact choice', () => {
    for (const level of THOROUGHNESS) expect(thoroughnessOf(LEVELS[level])).toBe(level);
    expect(thoroughnessOf({ ...LEVELS.thorough, secondReading: false })).toBeNull();
    expect(thoroughnessOf({ ...LEVELS.fast, reviewer: 'gemma-4-e4b-q4' })).toBeNull();
    expect(thoroughnessOf({ ...LEVELS.fast, corrector: null })).toBeNull();
  });

  it('lists the models a level loads including the second reader', () => {
    expect(levelModels('fast').map((model) => model.id)).toEqual(['glm-ocr-q8', 'gemma-4-e2b-q4']);
    expect(levelModels('thorough').map((model) => model.id)).toEqual([
      'glm-ocr-q8',
      'lightonocr-3-08b-q8',
      'gemma-4-e2b-q4',
      'gemma-4-e4b-q4',
    ]);
  });

  it('flags the levels that exceed the memory of the machine', () => {
    expect(exceeding(8)).toEqual(['thorough', 'veryThorough']);
    expect(exceeding(16)).toEqual(['veryThorough']);
    expect(exceeding(48)).toEqual([]);
    expect(exceeding(null)).toEqual([]);
  });
});

describe('second reading setting', () => {
  it('is off by default and remembers the choice', () => {
    const storage = memoryStorage();
    expect(loadSecondReading(storage)).toBe(false);
    saveSecondReading(true, storage);
    expect(storage.items.get(SECOND_READING_STORAGE_KEY)).toBe('on');
    expect(loadSecondReading(storage)).toBe(true);
    saveSecondReading(false, storage);
    expect(loadSecondReading(storage)).toBe(false);
  });

  it('falls back to off when the storage is missing or fails', () => {
    const failing = {
      getItem: () => {
        throw new Error('gesperrt');
      },
      setItem: () => {
        throw new Error('gesperrt');
      },
    };
    expect(loadSecondReading(null)).toBe(false);
    expect(loadSecondReading(failing)).toBe(false);
    expect(() => saveSecondReading(true, failing)).not.toThrow();
  });
});
