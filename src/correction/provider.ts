import type { Corrector } from './corrector.ts';

export type CorrectorStatus =
  | { readonly state: 'ready'; readonly corrector: Corrector; readonly preview: boolean }
  | { readonly state: 'needs-model'; readonly message: string }
  | { readonly state: 'unavailable'; readonly message: string };

export interface CorrectorEnvironment {
  readonly isDev: boolean;
  readonly isTauri: boolean;
  readonly loadPreview: () => Promise<Corrector>;
}

export const CORRECTOR_MISSING_MESSAGE =
  'Korrekturmodell fehlt. Zum Berichtigen muss einmalig das Korrekturmodell eingerichtet werden.';

export const CORRECTOR_DESKTOP_ONLY = 'Die Korrektur steht nur in der Desktop-App zur Verfügung.';

export async function resolveCorrector(env: CorrectorEnvironment): Promise<CorrectorStatus> {
  if (env.isTauri) return { state: 'needs-model', message: CORRECTOR_MISSING_MESSAGE };
  if (env.isDev) return { state: 'ready', corrector: await env.loadPreview(), preview: true };
  return { state: 'unavailable', message: CORRECTOR_DESKTOP_ONLY };
}
