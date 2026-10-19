import type { PageTranscriber } from './transcriber.ts';
import type { TranscriberEnvironment } from './provider.ts';

async function loadDemo(): Promise<PageTranscriber> {
  if (import.meta.env.DEV) {
    const { createDemoTranscriber } = await import('./demo-transcriber.ts');
    return createDemoTranscriber();
  }
  throw new Error('Der Demo-Transkribierer ist nur im Entwicklungsmodus verfügbar.');
}

export function browserEnvironment(): TranscriberEnvironment {
  return {
    isDev: import.meta.env.DEV,
    isTauri: '__TAURI_INTERNALS__' in window,
    loadDemo,
  };
}
