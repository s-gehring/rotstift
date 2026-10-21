import { useMemo } from 'react';
import type { CloudStep } from '../cloud/client.ts';
import { cloudLlmClient, cloudUsable, remoteCorrector, remoteEngine } from '../cloud/remote.ts';
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
  readonly cloud: CloudStep | null;
}

export type CreateCorrector = typeof createSidecarCorrector;

function useSidecarSetup(
  setup: ModelSetup<CorrectorInfo>,
  create: CreateCorrector,
  role: 'corrector' | 'reviewer',
  cloud: CloudStep | null,
): CorrectorSetup {
  const { model, refresh } = setup;
  const ready = setup.available && setup.status?.state === 'ready';
  const local = useMemo(
    () =>
      ready && cloud === null
        ? create(model, {
            onUnavailable: () => {
              void refresh();
            },
          })
        : null,
    [ready, model, refresh, create, cloud],
  );
  const remote = useMemo(() => {
    if (cloud === null || !cloudUsable(cloud)) return null;
    const remoteModel = remoteCorrector(cloud, role);
    return {
      model: remoteModel,
      corrector: create(remoteModel, { engine: remoteEngine(), client: cloudLlmClient(role) }),
    };
  }, [cloud, create, role]);
  if (cloud === null) return { setup, model, ready, corrector: local, cloud };
  return {
    setup,
    model: remote?.model ?? model,
    ready: remote !== null,
    corrector: remote?.corrector ?? null,
    cloud,
  };
}

export function useCorrectorSetup(
  client: ModelClient | null,
  create: CreateCorrector = createSidecarCorrector,
  cloud: CloudStep | null = null,
): CorrectorSetup {
  return useSidecarSetup(useCorrectorModelSetup(client), create, 'corrector', cloud);
}

export function useReviewerSetup(
  client: ModelClient | null,
  create: CreateCorrector = createSidecarCorrector,
  cloud: CloudStep | null = null,
): CorrectorSetup {
  return useSidecarSetup(useReviewerModelSetup(client), create, 'reviewer', cloud);
}
