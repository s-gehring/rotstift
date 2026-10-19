import { createLlmClient } from '../llm/client.ts';
import { createModelClient, type ModelClient } from '../models/client.ts';
import type { ModelInfo } from '../models/registry.ts';
import { createLlmTranscriber } from './llm-transcriber.ts';
import type { TranscriberEnvironment } from './provider.ts';
import type { PageTranscriber } from './transcriber.ts';

async function loadDemo(): Promise<PageTranscriber> {
  if (import.meta.env.DEV) {
    const { createDemoTranscriber } = await import('./demo-transcriber.ts');
    return createDemoTranscriber();
  }
  throw new Error('Der Demo-Transkribierer ist nur im Entwicklungsmodus verfügbar.');
}

export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export function browserModelClient(): ModelClient | null {
  return isTauri() ? createModelClient() : null;
}

export function browserEnvironment(): TranscriberEnvironment {
  return {
    isDev: import.meta.env.DEV,
    isTauri: isTauri(),
    loadDemo,
    createModelTranscriber: (model: ModelInfo, onUnavailable?: () => void) =>
      createLlmTranscriber({
        client: createLlmClient(),
        model,
        ...(onUnavailable && { onUnavailable }),
      }),
  };
}
