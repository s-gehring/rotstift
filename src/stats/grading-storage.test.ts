import { describe, expect, it } from 'vitest';
import { defaultGrading, type Grading } from './grading.ts';
import {
  GRADING_STORAGE_KEY,
  loadGradings,
  saveGradings,
  type GradingStorage,
} from './grading-storage.ts';

function memory(initial: string | null = null): GradingStorage & { value: string | null } {
  const store = {
    value: initial,
    getItem: () => store.value,
    setItem: (key: string, value: string) => {
      if (key === GRADING_STORAGE_KEY) store.value = value;
    },
  };
  return store;
}

const chosen: Grading = {
  ...defaultGrading(),
  enabled: true,
  limits: { ...defaultGrading().limits, grades: [1, 2.5, null, 4, 5] },
};

describe('grading storage', () => {
  it('keeps the grading per profile', () => {
    const storage = memory();
    saveGradings({ deutsch: chosen }, storage);
    expect(loadGradings(storage)).toEqual({ deutsch: chosen });
  });

  it('ignores broken or foreign content', () => {
    expect(loadGradings(memory('{'))).toEqual({});
    expect(loadGradings(memory('[]'))).toEqual({});
    expect(loadGradings(memory(JSON.stringify({ deutsch: { enabled: 'ja' } })))).toEqual({});
    const shortList = { ...chosen, limits: { ...chosen.limits, grades: [1, 2] } };
    expect(loadGradings(memory(JSON.stringify({ deutsch: shortList })))).toEqual({});
    const otherScale = { ...chosen, scale: 'percent' };
    expect(loadGradings(memory(JSON.stringify({ deutsch: otherScale })))).toEqual({});
  });

  it('drops limits that are no valid quotient', () => {
    const odd = { ...chosen, limits: { ...chosen.limits, grades: [-1, 2.55, 'x', 4, 500] } };
    expect(
      loadGradings(memory(JSON.stringify({ deutsch: odd })))['deutsch']?.limits.grades,
    ).toEqual([null, null, null, 4, null]);
  });

  it('survives a storage that throws', () => {
    const broken: GradingStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadGradings(broken)).toEqual({});
    expect(() => saveGradings({ deutsch: chosen }, broken)).not.toThrow();
  });
});
