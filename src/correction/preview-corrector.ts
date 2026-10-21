import type { CorrectResult, Corrector } from './corrector.ts';
import { createFakeCorrector } from './fake-corrector.ts';

export interface PreviewOptions {
  readonly delayMs?: number;
}

const CONJUNCTIONS = /(?<=\p{L}) (und|aber|weil|dass|and|but|because) /gu;

function toggleFirst(word: string): string {
  const first = word.charAt(0);
  const toggled = first === first.toLowerCase() ? first.toUpperCase() : first.toLowerCase();
  return toggled + word.slice(1);
}

export function previewCorrection(lines: readonly string[]): string {
  return lines
    .map((line, index) => {
      const words = line.replace(CONJUNCTIONS, ', $1 ').split(' ');
      const target = (index % 3) + 1;
      const word = words[target];
      if (word !== undefined && /^\p{L}{4,}$/u.test(word)) words[target] = toggleFirst(word);
      return words.join(' ');
    })
    .join('\n');
}

function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createPreviewCorrector(options: PreviewOptions = {}): Corrector {
  const { delayMs = 700 } = options;
  const fake = createFakeCorrector(previewCorrection);
  return {
    async correct(lines, profile, signal, scope): Promise<CorrectResult> {
      if (!(await wait(delayMs, signal))) return { ok: false, error: { kind: 'cancelled' } };
      return fake.correct(lines, profile, signal, scope);
    },
  };
}
