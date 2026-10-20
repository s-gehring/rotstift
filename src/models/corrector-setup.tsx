import { useCallback, useMemo, useState } from 'react';
import { createSidecarCorrector, type SidecarCorrector } from '../llm/sidecar-corrector.ts';
import type { ModelClient } from './client.ts';
import { ModelManagement } from './ModelManagement.tsx';
import { ModelSetupDialog } from './ModelSetupDialog.tsx';
import type { CorrectorInfo } from './registry.ts';
import { useCorrectorModelSetup, type ModelSetup } from './use-model-setup.ts';

export interface CorrectorSetup {
  readonly setup: ModelSetup<CorrectorInfo>;
  readonly model: CorrectorInfo;
  readonly ready: boolean;
  readonly corrector: SidecarCorrector | null;
  readonly dialogOpen: boolean;
  readonly openSetup: () => void;
  readonly closeSetup: () => void;
}

export type CreateCorrector = typeof createSidecarCorrector;

export function useCorrectorSetup(
  client: ModelClient | null,
  create: CreateCorrector = createSidecarCorrector,
): CorrectorSetup {
  const setup = useCorrectorModelSetup(client);
  const [dialogOpen, setDialogOpen] = useState(false);
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
  const openSetup = useCallback(() => {
    setDialogOpen(true);
  }, []);
  const closeSetup = useCallback(() => {
    setDialogOpen(false);
  }, []);
  return { setup, model, ready, corrector, dialogOpen, openSetup, closeSetup };
}

interface DialogProps {
  readonly corrector: CorrectorSetup;
  readonly switchDisabled?: boolean;
}

export function CorrectorSetupDialog({ corrector, switchDisabled = false }: DialogProps) {
  if (!corrector.setup.available) return null;
  return (
    <ModelSetupDialog
      setup={corrector.setup}
      open={corrector.dialogOpen}
      onClose={corrector.closeSetup}
      switchDisabled={switchDisabled}
    />
  );
}

interface ManagementProps {
  readonly corrector: CorrectorSetup;
  readonly disabled?: boolean;
}

export function CorrectorManagement({ corrector, disabled = false }: ManagementProps) {
  return (
    <ModelManagement setup={corrector.setup} onSetup={corrector.openSetup} disabled={disabled} />
  );
}
