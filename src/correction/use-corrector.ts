import { useEffect, useState } from 'react';
import { isTauri } from '../pipeline/environment.ts';
import type { Corrector } from './corrector.ts';
import { resolveCorrector, type CorrectorEnvironment, type CorrectorStatus } from './provider.ts';

async function loadPreview(): Promise<Corrector> {
  if (import.meta.env.DEV) {
    const { createPreviewCorrector } = await import('./preview-corrector.ts');
    return createPreviewCorrector();
  }
  throw new Error('Die Korrekturvorschau ist nur im Entwicklungsmodus verfügbar.');
}

export function browserCorrectorEnvironment(): CorrectorEnvironment {
  return { isDev: import.meta.env.DEV, isTauri: isTauri(), loadPreview };
}

export function useCorrector(): CorrectorStatus | null {
  const [status, setStatus] = useState<CorrectorStatus | null>(null);
  useEffect(() => {
    let current = true;
    resolveCorrector(browserCorrectorEnvironment()).then(
      (resolved) => {
        if (current) setStatus(resolved);
      },
      (error: unknown) => {
        if (current) {
          setStatus({
            state: 'unavailable',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return status;
}
