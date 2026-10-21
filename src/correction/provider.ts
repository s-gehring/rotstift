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

export interface ModelTexts {
  readonly missing: string;
  readonly desktopOnly: string;
  readonly downloading: string;
  readonly verifying: string;
  readonly importing: string;
  readonly deleting: string;
  readonly corrupt: string;
}

export const CORRECTOR_MISSING_MESSAGE =
  'Korrekturmodell fehlt. Zum Berichtigen muss einmalig das Korrekturmodell eingerichtet werden.';

export const CORRECTOR_DESKTOP_ONLY = 'Die Korrektur steht nur in der Desktop-App zur Verfügung.';

const CORRECTOR_VERIFYING =
  'Rotstift prüft einmalig, ob die Dateien des Korrekturmodells vollständig und unbeschädigt sind.';

export const CORRECTOR_TEXTS: ModelTexts = {
  missing: CORRECTOR_MISSING_MESSAGE,
  desktopOnly: CORRECTOR_DESKTOP_ONLY,
  downloading: 'Das Korrekturmodell wird heruntergeladen.',
  verifying: CORRECTOR_VERIFYING,
  importing: 'Das Korrekturmodell wird gerade aus Dateien importiert.',
  deleting: 'Das Korrekturmodell wird gerade gelöscht.',
  corrupt: 'Das Korrekturmodell ist beschädigt und muss neu eingerichtet werden.',
};

export const REVIEWER_MISSING_MESSAGE =
  'Das Modell für Inhalt und Form fehlt. Zum Prüfen von Inhalt und Form muss es einmalig eingerichtet werden.';

export const REVIEWER_DESKTOP_ONLY =
  'Die Prüfung von Inhalt und Form steht nur in der Desktop-App zur Verfügung.';

const REVIEWER_VERIFYING =
  'Rotstift prüft einmalig, ob die Dateien des Modells für Inhalt und Form vollständig und unbeschädigt sind.';

export const REVIEWER_TEXTS: ModelTexts = {
  missing: REVIEWER_MISSING_MESSAGE,
  desktopOnly: REVIEWER_DESKTOP_ONLY,
  downloading: 'Das Modell für Inhalt und Form wird heruntergeladen.',
  verifying: REVIEWER_VERIFYING,
  importing: 'Das Modell für Inhalt und Form wird gerade aus Dateien importiert.',
  deleting: 'Das Modell für Inhalt und Form wird gerade gelöscht.',
  corrupt: 'Das Modell für Inhalt und Form ist beschädigt und muss neu eingerichtet werden.',
};

function modelMessage(texts: ModelTexts, state: Exclude<ModelState, 'ready'>): string {
  switch (state) {
    case 'missing':
      return texts.missing;
    case 'downloading':
      return texts.downloading;
    case 'verifying':
    case 'unverified':
      return texts.verifying;
    case 'importing':
      return texts.importing;
    case 'deleting':
      return texts.deleting;
    case 'corrupt':
      return texts.corrupt;
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export async function resolveBrowserCorrector(
  env: CorrectorEnvironment,
  texts: ModelTexts = CORRECTOR_TEXTS,
): Promise<CorrectorStatus> {
  if (env.isDev) return { state: 'ready', corrector: await env.loadPreview(), preview: true };
  return { state: 'unavailable', message: texts.desktopOnly };
}

export function sidecarCorrectorStatus(
  availability: SidecarAvailability | null,
  texts: ModelTexts = CORRECTOR_TEXTS,
): CorrectorStatus | null {
  if (availability === null) return null;
  const { state, corrector } = availability;
  if (state !== 'ready') return { state: 'needs-model', message: modelMessage(texts, state) };
  if (corrector === null) return { state: 'needs-model', message: texts.verifying };
  return {
    state: 'ready',
    corrector,
    preview: false,
    ...(corrector.engine !== undefined && { engine: corrector.engine }),
  };
}
