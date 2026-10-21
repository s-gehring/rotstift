import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import {
  loadOverrides,
  resolveWeighting,
  saveOverrides,
  WEIGHTING_STORAGE_KEY,
  type WeightingStorage,
} from './weighting-storage.ts';
import { defaultWeighting } from './weighting.ts';

function memory(initial?: string): WeightingStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
  };
}

describe('weighting storage', () => {
  it('round-trips overrides', () => {
    const storage = memory();
    const weighting = { weights: { R: 0.5 }, repeatsOnce: false };
    saveOverrides({ deutsch: weighting }, storage);
    expect(loadOverrides(storage)).toEqual({ deutsch: weighting });
    expect(WEIGHTING_STORAGE_KEY).toBe('rotstift.weighting');
  });

  it('ignores broken or foreign content', () => {
    expect(loadOverrides(memory('{'))).toEqual({});
    expect(loadOverrides(memory('[1]'))).toEqual({});
    expect(
      loadOverrides(memory(JSON.stringify({ deutsch: { weights: {}, repeatsOnce: 'ja' } }))),
    ).toEqual({});
    expect(loadOverrides(null)).toEqual({});
  });

  it('drops weights outside the offered steps', () => {
    const storage = memory(
      JSON.stringify({ deutsch: { weights: { R: 0.5, Z: 7, G: 'x' }, repeatsOnce: true } }),
    );
    expect(loadOverrides(storage)).toEqual({
      deutsch: { weights: { R: 0.5 }, repeatsOnce: true },
    });
  });

  it('survives storage that throws', () => {
    const broken: WeightingStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(loadOverrides(broken)).toEqual({});
    expect(() => saveOverrides({}, broken)).not.toThrow();
  });

  it('lays overrides over the defaults of the profile', () => {
    const resolved = resolveWeighting(DEUTSCH, {
      deutsch: { weights: { R: 0.5 }, repeatsOnce: false },
    });
    expect(resolved.weights).toEqual({ ...defaultWeighting(DEUTSCH).weights, R: 0.5 });
    expect(resolved.repeatsOnce).toBe(false);
    expect(resolveWeighting(ENGLISCH, {})).toEqual(defaultWeighting(ENGLISCH));
  });
});
