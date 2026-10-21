import type { CorrectionProfile } from '../annotations/profile.ts';
import { defaultWeighting, WEIGHT_STEPS, type Weighting } from './weighting.ts';

export const WEIGHTING_STORAGE_KEY = 'rotstift.weighting';

export type WeightingStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type WeightingOverrides = Readonly<Record<string, Weighting>>;

function defaultStorage(): WeightingStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readWeighting(value: unknown): Weighting | null {
  if (!isRecord(value) || typeof value['repeatsOnce'] !== 'boolean') return null;
  const raw = value['weights'];
  if (!isRecord(raw)) return null;
  const weights: Record<string, number> = {};
  for (const [code, weight] of Object.entries(raw)) {
    if (typeof weight === 'number' && WEIGHT_STEPS.includes(weight)) weights[code] = weight;
  }
  return { weights, repeatsOnce: value['repeatsOnce'] };
}

export function loadOverrides(
  storage: WeightingStorage | null = defaultStorage(),
): WeightingOverrides {
  try {
    const text = storage?.getItem(WEIGHTING_STORAGE_KEY);
    if (text === null || text === undefined) return {};
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return {};
    const result: Record<string, Weighting> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const weighting = readWeighting(value);
      if (weighting !== null) result[id] = weighting;
    }
    return result;
  } catch {
    return {};
  }
}

export function saveOverrides(
  overrides: WeightingOverrides,
  storage: WeightingStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(WEIGHTING_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    return;
  }
}

export function resolveWeighting(
  profile: CorrectionProfile,
  overrides: WeightingOverrides,
): Weighting {
  const base = defaultWeighting(profile);
  const override = overrides[profile.id];
  if (override === undefined) return base;
  return {
    weights: { ...base.weights, ...override.weights },
    repeatsOnce: override.repeatsOnce,
  };
}
