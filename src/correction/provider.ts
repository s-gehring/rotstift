import type { ModelState } from '../models/types.ts';
import type { EngineMonitor } from '../pipeline/transcriber.ts';
import type { Corrector } from './corrector.ts';

export type CorrectorStatus =
  | {
      readonly state: 'ready';
      readonly corrector: Corrector;
      readonly preview: boolean;
      readonly engine?: EngineMonitor;
    }
  | { readonly state: 'needs-model'; readonly message: string }
  | { readonly state: 'unavailable'; readonly message: string };

export interface CorrectorEnvironment {
  readonly isDev: boolean;
  readonly loadPreview: () => Promise<Corrector>;
}

export interface SidecarAvailability {
  readonly state: ModelState;
  readonly corrector: (Corrector & { readonly engine?: EngineMonitor }) | null;
}

export const CORRECTOR_MISSING_MESSAGE =
  'Korrekturmodell fehlt. Zum Berichtigen muss einmalig das Korrekturmodell eingerichtet werden.';

export const CORRECTOR_DESKTOP_ONLY = 'Die Korrektur steht nur in der Desktop-App zur Verfügung.';

const VERIFYING_MESSAGE = 'Das Korrekturmodell wird geprüft. Das dauert einen Moment.';

const MODEL_MESSAGE: Readonly<Record<Exclude<ModelState, 'ready'>, string>> = {
  missing: CORRECTOR_MISSING_MESSAGE,
  downloading: 'Das Korrekturmodell wird heruntergeladen.',
  verifying: VERIFYING_MESSAGE,
  unverified: VERIFYING_MESSAGE,
  importing: 'Das Korrekturmodell wird gerade aus Dateien importiert.',
  deleting: 'Das Korrekturmodell wird gerade gelöscht.',
  corrupt: 'Das Korrekturmodell ist beschädigt und muss neu eingerichtet werden.',
};

export async function resolveBrowserCorrector(env: CorrectorEnvironment): Promise<CorrectorStatus> {
  if (env.isDev) return { state: 'ready', corrector: await env.loadPreview(), preview: true };
  return { state: 'unavailable', message: CORRECTOR_DESKTOP_ONLY };
}

export function sidecarCorrectorStatus(
  availability: SidecarAvailability | null,
): CorrectorStatus | null {
  if (availability === null) return null;
  const { state, corrector } = availability;
  if (state !== 'ready') return { state: 'needs-model', message: MODEL_MESSAGE[state] };
  if (corrector === null) return { state: 'needs-model', message: VERIFYING_MESSAGE };
  return {
    state: 'ready',
    corrector,
    preview: false,
    ...(corrector.engine !== undefined && { engine: corrector.engine }),
  };
}
