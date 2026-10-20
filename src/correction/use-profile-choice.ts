import { useCallback, useState } from 'react';
import { BUILT_IN_PROFILES, type CorrectionProfile } from '../annotations/profile.ts';
import { loadProfile, saveProfile, type ProfileStorage } from './profile-choice.ts';

export function useProfileChoice(
  profiles: readonly CorrectionProfile[] = BUILT_IN_PROFILES,
  storage?: ProfileStorage | null,
) {
  const [profile, setProfile] = useState(() => loadProfile(profiles, storage));
  const select = useCallback(
    (next: CorrectionProfile) => {
      setProfile(next);
      saveProfile(next, storage);
    },
    [storage],
  );
  return { profile, select };
}
