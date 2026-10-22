import { useCallback, useMemo, useState } from 'react';
import { loadSecondReading, saveSecondReading, type SecondReadingStorage } from './thoroughness.ts';

export interface SecondReading {
  readonly enabled: boolean;
  readonly set: (enabled: boolean) => void;
}

export function useSecondReading(storage?: SecondReadingStorage | null): SecondReading {
  const [enabled, setEnabled] = useState(() => loadSecondReading(storage));
  const set = useCallback(
    (next: boolean) => {
      setEnabled(next);
      saveSecondReading(next, storage);
    },
    [storage],
  );
  return useMemo(() => ({ enabled, set }), [enabled, set]);
}
