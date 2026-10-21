import { useMemo } from 'react';
import { createSidecarCorrector, type SidecarCorrector } from '../llm/sidecar-corrector.ts';
import type { ModelClient } from './client.ts';
import type { CorrectorInfo } from './registry.ts';
import {
  useCorrectorModelSetup,
  useReviewerModelSetup,
  type ModelSetup,
} from './use-model-setup.ts';

export interface CorrectorSetup {
  readonly setup: ModelSetup<CorrectorInfo>;
  readonly model: CorrectorInfo;
  readonly ready: boolean;
  readonly corrector: SidecarCorrector | null;
}

export type CreateCorrector = typeof createSidecarCorrector;

function useSidecarSetup(
  setup: ModelSetup<CorrectorInfo>,
  create: CreateCorrector,
): CorrectorSetup {
  const { model, refresh } = setup;
  const ready = setup.available && setup.status?.state === 'ready';
  const corrector = useMemo(
    () =>
      ready
        ? create(model, {
            onUnavailable: () => {
              void refresh();
            },
          })
        : null,
    [ready, model, refresh, create],
  );
  return { setup, model, ready, corrector };
}

export function useCorrectorSetup(
  client: ModelClient | null,
  create: CreateCorrector = createSidecarCorrector,
): CorrectorSetup {
  return useSidecarSetup(useCorrectorModelSetup(client), create);
}

export function useReviewerSetup(
  client: ModelClient | null,
  create: CreateCorrector = createSidecarCorrector,
): CorrectorSetup {
  return useSidecarSetup(useReviewerModelSetup(client), create);
}
