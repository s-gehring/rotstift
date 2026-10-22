import { findDemoPage, type DemoPage } from './demo-class.ts';
import type { PageTranscriber, TranscribeResult } from './transcriber.ts';

export const DEMO_MARKER = 'Demo-Text';

const SAMPLES: readonly (readonly string[])[] = [
  [
    `${DEMO_MARKER}: Dieser Text stammt nicht aus einer echten Erkennung.`,
    'Am Montag sind wir mit der Klasse in den Wald ge-',
    'gangen und haben Blätter gesammelt.',
  ],
  [
    `${DEMO_MARKER}: Platzhalter für die Entwicklung.`,
    'Die Sonne schien, aber es war trotzdem kalt.',
    'Ich habe meine Mütze vergessen.',
    'Zum Glück hatte Lena eine zweite dabei.',
  ],
  [`${DEMO_MARKER}: Nur eine kurze Seite.`, 'Das war alles.'],
];

export interface DemoOptions {
  readonly delayMs?: number;
  readonly failEvery?: number;
  readonly recognize?: (png: Blob) => Promise<Pick<DemoPage, 'lines'> | null>;
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

export function createDemoTranscriber(options: DemoOptions = {}): PageTranscriber {
  const { delayMs = 800, failEvery = 4, recognize = findDemoPage } = options;
  let calls = 0;
  return {
    async transcribe(png, signal): Promise<TranscribeResult> {
      try {
        await wait(delayMs, signal);
      } catch {
        return { ok: false, error: { kind: 'cancelled' } };
      }
      const known = await recognize(png);
      if (known !== null) return { ok: true, lines: known.lines };
      calls += 1;
      if (failEvery > 0 && calls % failEvery === 0) {
        return {
          ok: false,
          error: { kind: 'failed', message: `${DEMO_MARKER}: Simulierter Fehler zum Testen.` },
        };
      }
      return { ok: true, lines: SAMPLES[(calls - 1) % SAMPLES.length] ?? [] };
    },
  };
}
