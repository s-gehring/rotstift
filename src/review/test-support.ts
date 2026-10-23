import type { CorrectResult, Corrector } from '../correction/corrector.ts';
import type { PageReading } from '../correction/uncertain-reading.ts';
import type { ImportPage } from '../import/pages.ts';
import type { LayoutResult, Ruling } from '../layout/types.ts';
import { noDiagnostics } from '../pipeline/diagnostics.ts';
import { createRunner } from '../pipeline/runner.ts';
import type { PageTranscriber, TranscribeResult } from '../pipeline/transcriber.ts';
import { createReviewFlow, type ReviewDeps, type ReviewImage } from './review-flow.ts';

export function page(id: string): ImportPage {
  return {
    id,
    fileKey: id,
    label: `${id}.png`,
    source: { kind: 'image', file: new File([], `${id}.png`) },
    width: 1000,
    height: 1400,
    rotation: 0,
    thumbnailUrl: `blob:thumb-${id}`,
  };
}

export function deferred() {
  const handle: { resolve: () => void } = { resolve: () => undefined };
  const promise = new Promise<void>((resolve) => {
    handle.resolve = resolve;
  });
  return {
    promise,
    resolve: () => {
      handle.resolve();
    },
  };
}

function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function waitFor(check: () => boolean) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await tick();
  }
  throw new Error('condition not reached');
}

const TEXTS: Record<string, readonly string[]> = {
  a: ['Ich war im Schwimbad.', 'Es war schön.'],
  b: ['Wir gingen heim.'],
  c: ['Der Tag war lang.'],
};

const FIXES: Record<string, string> = {
  'Ich war im Schwimbad.': 'Ich war im Schwimmbad.\nEs war schön.',
};

export interface Harness {
  readonly log: string[];
  transcripts: Record<string, TranscribeResult>;
  corrections: Record<string, CorrectResult>;
  transcribeGate: Promise<void> | null;
  correctGate: Promise<void> | null;
  locateGate: Promise<void> | null;
  layoutFails: boolean;
  ruling?: Ruling;
  imageFails: boolean;
  correctThrows: boolean;
}

export function setupReview(
  ids: readonly string[] = ['a', 'b', 'c'],
  extra: Pick<ReviewDeps, 'logReview' | 'now'> = {},
) {
  const pages = ids.map(page);
  const h: Harness = {
    log: [],
    transcripts: Object.fromEntries(
      ids.map((id) => [id, { ok: true, lines: TEXTS[id] ?? ['Text.'] }]),
    ),
    corrections: {},
    transcribeGate: null,
    correctGate: null,
    locateGate: null,
    layoutFails: false,
    imageFails: false,
    correctThrows: false,
  };
  const transcriber: PageTranscriber = {
    async transcribe(png, signal) {
      const id = await png.text();
      h.log.push(`T:${id}`);
      if (h.transcribeGate !== null) {
        await Promise.race([h.transcribeGate, untilAborted(signal)]);
        if (signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
      }
      return h.transcripts[id] ?? { ok: false, error: { kind: 'failed', message: 'unbekannt' } };
    },
  };
  const corrector: Corrector = {
    async correct(lines, _profile, signal) {
      const first = lines[0] ?? '';
      h.log.push(`C:${first}`);
      if (h.correctThrows) throw new Error('Speicher voll');
      if (h.correctGate !== null) {
        await Promise.race([h.correctGate, untilAborted(signal)]);
        if (signal.aborted) return { ok: false, error: { kind: 'cancelled' } };
      }
      return h.corrections[first] ?? { ok: true, correctedText: FIXES[first] ?? lines.join('\n') };
    },
  };
  const runner = createRunner({
    render: (p) => Promise.resolve(new Blob([p.id])),
    diagnostics: noDiagnostics,
  });
  runner.setTranscriber(transcriber);
  runner.setPages(pages);
  const flow = createReviewFlow({
    ...extra,
    transcription: runner,
    loadImage: (p): Promise<ReviewImage> =>
      h.imageFails
        ? Promise.reject(new Error('Bild kaputt'))
        : Promise.resolve({ blob: new Blob([p.id]), width: 1000, height: 1400 }),
    locator: {
      async locate(blob, lines): Promise<LayoutResult> {
        const id = blob instanceof Blob ? await blob.text() : '';
        h.log.push(`L:${id}`);
        if (h.locateGate !== null) await h.locateGate;
        if (h.layoutFails) throw new Error('kaputt');
        return {
          lines: lines.map((_, index) => ({
            bbox: { x: 100, y: 100 + index * 60, width: 700, height: 40 },
            confidence: 1,
          })),
          skewDegrees: 0,
          detectedLines: lines.length,
          ...(h.ruling && { ruling: h.ruling }),
        };
      },
    },
  });
  flow.setCorrector(corrector);
  flow.setReviewer(corrector);
  return { pages, h, runner, flow, transcriber, corrector };
}

export function readingOf(
  lines: readonly string[],
  uncertain: Readonly<Record<string, number>>,
  uncertainBelow = 0.95,
): PageReading {
  return {
    lines: lines.map((line) =>
      Array.from(line.matchAll(/\S+/gu), ([text]) => ({ text, confidence: uncertain[text] ?? 1 })),
    ),
    uncertainBelow,
  };
}
