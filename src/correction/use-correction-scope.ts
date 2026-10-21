import { useCallback, useState } from 'react';
import {
  DEFAULT_SCOPE,
  loadScopeKinds,
  saveScopeKinds,
  type CorrectionScope,
  type ScopeStorage,
} from './scope.ts';

export function useCorrectionScope(hasClass: boolean, storage?: ScopeStorage | null) {
  const [scope, setStoredScope] = useState<CorrectionScope>(() => ({
    ...DEFAULT_SCOPE,
    ...loadScopeKinds(storage),
  }));
  const [hadClass, setHadClass] = useState(hasClass);
  if (hadClass !== hasClass) {
    setHadClass(hasClass);
    if (!hasClass) setStoredScope((current) => ({ ...current, formName: '', assignment: '' }));
  }
  const setScope = useCallback(
    (next: CorrectionScope) => {
      setStoredScope(next);
      saveScopeKinds(next, storage);
    },
    [storage],
  );
  return { scope, setScope };
}
