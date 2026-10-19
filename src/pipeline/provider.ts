import type { PageTranscriber, TranscriberStatus } from './transcriber.ts';

export interface TranscriberEnvironment {
  readonly isDev: boolean;
  readonly isTauri: boolean;
  readonly loadDemo: () => Promise<PageTranscriber>;
}

export const NOT_CONFIGURED_MESSAGE =
  'Die Texterkennung ist auf diesem Rechner noch nicht eingerichtet.';

export const DESKTOP_ONLY_MESSAGE = 'Die Texterkennung steht nur in der Desktop-App zur Verfügung.';

export async function resolveTranscriber(env: TranscriberEnvironment): Promise<TranscriberStatus> {
  if (env.isTauri) return { state: 'unavailable', message: NOT_CONFIGURED_MESSAGE };
  if (env.isDev) return { state: 'ready', transcriber: await env.loadDemo(), demo: true };
  return { state: 'unavailable', message: DESKTOP_ONLY_MESSAGE };
}
