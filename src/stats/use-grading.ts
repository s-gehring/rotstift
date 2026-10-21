import { useCallback, useMemo, useState } from 'react';
import type { CorrectionProfile } from '../annotations/profile.ts';
import { defaultGrading, type Grading } from './grading.ts';
import {
  loadGradings,
  saveGradings,
  type GradingOverrides,
  type GradingStorage,
} from './grading-storage.ts';

export interface GradingModel {
  readonly of: (profile: CorrectionProfile) => Grading;
  readonly set: (profile: CorrectionProfile, grading: Grading) => void;
}

export function useGrading(storage?: GradingStorage | null): GradingModel {
  const [gradings, setGradings] = useState<GradingOverrides>(() => loadGradings(storage));
  const commit = useCallback(
    (next: GradingOverrides) => {
      setGradings(next);
      saveGradings(next, storage);
    },
    [storage],
  );
  return useMemo(
    () => ({
      of: (profile) => gradings[profile.id] ?? defaultGrading(),
      set: (profile, grading) => commit({ ...gradings, [profile.id]: grading }),
    }),
    [gradings, commit],
  );
}

export function fixedGrading(grading: Grading = defaultGrading()): GradingModel {
  return { of: () => grading, set: () => undefined };
}
