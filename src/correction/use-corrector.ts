import { useEffect, useMemo, useState } from 'react';
import type { ModelClient } from '../models/client.ts';
import {
  useCorrectorSetup,
  type CorrectorSetup,
  type CreateCorrector,
} from '../models/corrector-setup.ts';
import type { Corrector } from './corrector.ts';
import {
  resolveBrowserCorrector,
  sidecarCorrectorStatus,
  type CorrectorEnvironment,
  type CorrectorStatus,
} from './provider.ts';

async function loadPreview(): Promise<Corrector> {
  if (import.meta.env.DEV) {
    const { createPreviewCorrector } = await import('./preview-corrector.ts');
    return createPreviewCorrector();
  }
  throw new Error('Die Korrekturvorschau ist nur im Entwicklungsmodus verfügbar.');
}

export function browserCorrectorEnvironment(): CorrectorEnvironment {
  return { isDev: import.meta.env.DEV, loadPreview };
}

function useBrowserCorrector(enabled: boolean): CorrectorStatus | null {
  const [status, setStatus] = useState<CorrectorStatus | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    resolveBrowserCorrector(browserCorrectorEnvironment()).then(
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
  }, [enabled]);
  return enabled ? status : null;
}

export interface CorrectorChoice {
  readonly status: CorrectorStatus | null;
  readonly setup: CorrectorSetup;
}

export function useCorrector(
  client: ModelClient | null,
  create?: CreateCorrector,
): CorrectorChoice {
  const setup = useCorrectorSetup(client, create);
  const browser = useBrowserCorrector(client === null);
  const modelState = setup.setup.status?.state;
  const sidecar = useMemo(
    () =>
      sidecarCorrectorStatus(
        modelState === undefined ? null : { state: modelState, corrector: setup.corrector },
      ),
    [modelState, setup.corrector],
  );
  return { status: client === null ? browser : sidecar, setup };
}
