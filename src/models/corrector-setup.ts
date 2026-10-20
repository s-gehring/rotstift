import { useMemo } from 'react';
import { createSidecarCorrector, type SidecarCorrector } from '../llm/sidecar-corrector.ts';
import type { ModelClient } from './client.ts';
import type { CorrectorInfo } from './registry.ts';
import { useCorrectorModelSetup, type ModelSetup } from './use-model-setup.ts';

export interface CorrectorSetup {
  readonly setup: ModelSetup<CorrectorInfo>;
  readonly model: CorrectorInfo;
  readonly ready: boolean;
  readonly corrector: SidecarCorrector | null;
}

export type CreateCorrector = typeof createSidecarCorrector;

export function useCorrectorSetup(
  client: ModelClient | null,
  create: CreateCorrector = createSidecarCorrector,
): CorrectorSetup {
  const setup = useCorrectorModelSetup(client);
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
