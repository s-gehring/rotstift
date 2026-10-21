import { useCallback, useMemo, useState } from 'react';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { defaultWeighting, sameWeighting, type Weighting } from './weighting.ts';
import {
  loadOverrides,
  resolveWeighting,
  saveOverrides,
  type WeightingOverrides,
  type WeightingStorage,
} from './weighting-storage.ts';

export interface WeightingModel {
  readonly of: (profile: CorrectionProfile) => Weighting;
  readonly isDefault: (profile: CorrectionProfile) => boolean;
  readonly set: (profile: CorrectionProfile, weighting: Weighting) => void;
  readonly reset: (profile: CorrectionProfile) => void;
}

export function useWeighting(storage?: WeightingStorage | null): WeightingModel {
  const [overrides, setOverrides] = useState<WeightingOverrides>(() => loadOverrides(storage));
  const commit = useCallback(
    (next: WeightingOverrides) => {
      setOverrides(next);
      saveOverrides(next, storage);
    },
    [storage],
  );
  return useMemo(
    () => ({
      of: (profile) => resolveWeighting(profile, overrides),
      isDefault: (profile) =>
        sameWeighting(profile, resolveWeighting(profile, overrides), defaultWeighting(profile)),
      set: (profile, weighting) => commit({ ...overrides, [profile.id]: weighting }),
      reset: (profile) => {
        const { [profile.id]: _removed, ...rest } = overrides;
        commit(rest);
      },
    }),
    [overrides, commit],
  );
}

export function fixedWeighting(): WeightingModel {
  return {
    of: defaultWeighting,
    isDefault: () => true,
    set: () => undefined,
    reset: () => undefined,
  };
}
