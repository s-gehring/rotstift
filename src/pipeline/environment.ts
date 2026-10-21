import { createLayoutLocator, type LayoutLocator } from '../layout/layout-client.ts';
import { createLlmClient } from '../llm/client.ts';
import { sharedEngine } from '../llm/engine.ts';
import { createModelClient, type ModelClient } from '../models/client.ts';
import type { ModelInfo } from '../models/registry.ts';
import { createLlmTranscriber } from './llm-transcriber.ts';
import type { TranscriberEnvironment } from './provider.ts';
import { withStruckWords } from './struck-words.ts';
import type { PageTranscriber } from './transcriber.ts';

let struckLocator: LayoutLocator | null = null;

function findStruckWords(png: Blob, lines: readonly string[]): Promise<number[][]> {
  struckLocator ??= createLayoutLocator();
  return struckLocator.struckWords(png, lines);
}

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
      withStruckWords(
        createLlmTranscriber({
          client: createLlmClient(),
          engine: sharedEngine(),
          model,
          ...(onUnavailable && { onUnavailable }),
        }),
        findStruckWords,
      ),
  };
}
