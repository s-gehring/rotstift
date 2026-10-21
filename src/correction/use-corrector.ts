import { useEffect, useMemo, useState } from 'react';
import type { CloudStep } from '../cloud/client.ts';
import { cloudBlockedMessage } from '../cloud/remote.ts';
import type { ModelClient } from '../models/client.ts';
import {
  useCorrectorSetup,
  useReviewerSetup,
  type CorrectorSetup,
  type CreateCorrector,
} from '../models/corrector-setup.ts';
import type { Corrector } from './corrector.ts';
import {
  CORRECTOR_TEXTS,
  resolveBrowserCorrector,
  REVIEWER_TEXTS,
  sidecarCorrectorStatus,
  type CorrectorEnvironment,
  type CorrectorStatus,
  type ModelTexts,
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

function useBrowserCorrector(enabled: boolean, texts: ModelTexts): CorrectorStatus | null {
  const [status, setStatus] = useState<CorrectorStatus | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    resolveBrowserCorrector(browserCorrectorEnvironment(), texts).then(
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
  }, [enabled, texts]);
  return enabled ? status : null;
}

export interface CorrectorChoice {
  readonly status: CorrectorStatus | null;
  readonly setup: CorrectorSetup;
}

function useCorrectorStatus(
  client: ModelClient | null,
  setup: CorrectorSetup,
  texts: ModelTexts,
): CorrectorChoice {
  const browser = useBrowserCorrector(client === null, texts);
  const modelState = setup.setup.status?.state;
  const { cloud, corrector } = setup;
  const sidecar = useMemo((): CorrectorStatus | null => {
    if (cloud !== null) {
      return corrector === null
        ? { state: 'unavailable', message: cloudBlockedMessage(cloud) }
        : { state: 'ready', corrector, preview: false, engine: corrector.engine };
    }
    return sidecarCorrectorStatus(
      modelState === undefined ? null : { state: modelState, corrector },
      texts,
    );
  }, [modelState, corrector, cloud, texts]);
  return { status: client === null ? browser : sidecar, setup };
}

export function useCorrector(
  client: ModelClient | null,
  create?: CreateCorrector,
  cloud: CloudStep | null = null,
): CorrectorChoice {
  return useCorrectorStatus(client, useCorrectorSetup(client, create, cloud), CORRECTOR_TEXTS);
}

export function useReviewer(
  client: ModelClient | null,
  create?: CreateCorrector,
  cloud: CloudStep | null = null,
): CorrectorChoice {
  return useCorrectorStatus(client, useReviewerSetup(client, create, cloud), REVIEWER_TEXTS);
}
