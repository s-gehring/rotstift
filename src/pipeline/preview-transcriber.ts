import type { PageTranscriber, TranscribeResult } from './transcriber.ts';

export const PREVIEW_MARKER = 'Vorschautext';

export const PREVIEW_LINES = 5;

export interface PreviewOptions {
  readonly delayMs?: number;
  readonly failEvery?: number;
  readonly lines?: number;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createPreviewTranscriber(options: PreviewOptions = {}): PageTranscriber {
  const { delayMs = 800, failEvery = 4, lines = PREVIEW_LINES } = options;
  let calls = 0;
  return {
    async transcribe(_png, signal): Promise<TranscribeResult> {
      try {
        await wait(delayMs, signal);
      } catch {
        return { ok: false, error: { kind: 'cancelled' } };
      }
      calls += 1;
      if (failEvery > 0 && calls % failEvery === 0) {
        return {
          ok: false,
          error: { kind: 'failed', message: `${PREVIEW_MARKER}: Simulierter Fehler zum Testen.` },
        };
      }
      return {
        ok: true,
        lines: Array.from(
          { length: lines },
          (_, index) => `${PREVIEW_MARKER} Platzhalter dieser Zeile ${index + 1}`,
        ),
      };
    },
  };
}
