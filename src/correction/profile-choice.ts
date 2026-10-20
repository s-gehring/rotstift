import { BUILT_IN_PROFILES } from '../annotations/profile.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';

export const PROFILE_STORAGE_KEY = 'rotstift.correction-profile';

export type ProfileStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): ProfileStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadProfile(
  profiles: readonly CorrectionProfile[] = BUILT_IN_PROFILES,
  storage: ProfileStorage | null = defaultStorage(),
): CorrectionProfile {
  let id: string | null = null;
  try {
    id = storage?.getItem(PROFILE_STORAGE_KEY) ?? null;
  } catch {
    id = null;
  }
  const stored = profiles.find((profile) => profile.id === id);
  const fallback = profiles[0];
  if (stored) return stored;
  if (fallback) return fallback;
  throw new Error('Es gibt kein Korrekturprofil.');
}

export function saveProfile(
  profile: CorrectionProfile,
  storage: ProfileStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PROFILE_STORAGE_KEY, profile.id);
  } catch {
    return;
  }
}
