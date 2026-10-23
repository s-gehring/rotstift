import { useMemo } from 'react';
import type { CloudStep } from '../cloud/client.ts';
import { cloudLlmClient, cloudUsable, remoteCorrector, remoteEngine } from '../cloud/remote.ts';
import type { Invoke } from '../llm/client.ts';
import type { CloudModel } from '../cloud/use-cloud.ts';
import type { Corrector } from '../correction/corrector.ts';
import type { CorrectorStatus } from '../correction/provider.ts';
import { createSidecarCorrector } from '../llm/sidecar-corrector.ts';
import { withPseudonymization } from '../privacy/pseudonymizing-corrector.ts';
import type { Shield, Shields } from '../review/review-flow.ts';

export const PREVIEW_PROTECTION_PARAM = 'schutz';

export type ShieldRole = 'corrector' | 'reviewer';

export type CreateShieldCorrector = (step: CloudStep, role: ShieldRole) => Corrector;

export function createShieldCorrector(
  step: CloudStep,
  role: ShieldRole,
  invoke?: Invoke,
): Corrector {
  return createSidecarCorrector(remoteCorrector(step, role), {
    engine: remoteEngine(),
    client: cloudLlmClient(role, invoke, { pseudonymized: true }),
  });
}

function shieldOf(inner: Corrector): Shield {
  return (pages) => withPseudonymization(inner, pages);
}

export function cloudShields(
  cloud: Pick<CloudModel, 'steps' | 'protects'>,
  create: CreateShieldCorrector = createShieldCorrector,
): Shields {
  const shieldFor = (role: ShieldRole): Shield | undefined => {
    const step = cloud.steps[role];
    if (!cloud.protects(role) || !cloudUsable(step, role)) return undefined;
    return shieldOf(create(step, role));
  };
  const corrector = shieldFor('corrector');
  const reviewer = shieldFor('reviewer');
  return {
    ...(corrector !== undefined && { corrector }),
    ...(reviewer !== undefined && { reviewer }),
  };
}

export function previewShields(
  corrector: CorrectorStatus | null,
  reviewer: CorrectorStatus | null,
): Shields {
  return {
    ...(corrector?.state === 'ready' && { corrector: shieldOf(corrector.corrector) }),
    ...(reviewer?.state === 'ready' && { reviewer: shieldOf(reviewer.corrector) }),
  };
}

export function previewProtection(): boolean {
  try {
    return new URLSearchParams(globalThis.location.search).has(PREVIEW_PROTECTION_PARAM);
  } catch {
    return false;
  }
}

export function useShields(
  cloud: CloudModel,
  preview: {
    readonly corrector: CorrectorStatus | null;
    readonly reviewer: CorrectorStatus | null;
  } | null,
): Shields {
  const { steps, protects } = cloud;
  const previewCorrector = preview?.corrector ?? null;
  const previewReviewer = preview?.reviewer ?? null;
  const usePreview = preview !== null;
  return useMemo(
    () =>
      usePreview
        ? previewShields(previewCorrector, previewReviewer)
        : cloudShields({ steps, protects }),
    [usePreview, previewCorrector, previewReviewer, steps, protects],
  );
}
