import { buildClassPdf, buildCorrectedPdf, buildWordCountPdf } from './build-pdf.ts';
import { saveFile, type Invoke, type SaveOutcome } from './save-file.ts';
import type {
  ClassArbeit,
  ClassExportOptions,
  CorrectedArbeit,
  ExportOptions,
  WordCountArbeit,
} from './types.ts';

export type SavePhase = 'building' | 'saving';

export interface SavePdfOptions extends ExportOptions {
  readonly invoke?: Invoke | null;
  readonly onPhase?: (phase: SavePhase) => void;
}

export interface SaveClassPdfOptions extends ClassExportOptions {
  readonly invoke?: Invoke | null;
  readonly onPhase?: (phase: SavePhase) => void;
}

const CLASS_PDF_NAME = 'Alle Arbeiten';

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');
}

async function buildAndSave(
  build: () => Promise<Uint8Array>,
  suggestedName: string,
  options: {
    readonly signal?: AbortSignal;
    readonly invoke?: Invoke | null;
    readonly onPhase?: (phase: SavePhase) => void;
  },
): Promise<SaveOutcome> {
  let bytes: Uint8Array;
  options.onPhase?.('building');
  try {
    bytes = await build();
    options.signal?.throwIfAborted();
  } catch (error) {
    return isAbort(error, options.signal)
      ? { state: 'cancelled' }
      : { state: 'failed', reason: 'build' };
  }
  options.onPhase?.('saving');
  return saveFile('pdf', bytes, suggestedName, options.invoke);
}

export function saveCorrectedPdf(
  arbeit: CorrectedArbeit,
  options: SavePdfOptions = {},
): Promise<SaveOutcome> {
  return buildAndSave(
    () => buildCorrectedPdf(arbeit, options),
    `${arbeit.title} (korrigiert)`,
    options,
  );
}

export function saveWordCountPdf(
  arbeit: WordCountArbeit,
  options: SavePdfOptions = {},
): Promise<SaveOutcome> {
  return buildAndSave(
    () => buildWordCountPdf(arbeit, options),
    `${arbeit.title} (Wortzahl)`,
    options,
  );
}

export function saveClassPdf(
  arbeiten: readonly ClassArbeit[],
  options: SaveClassPdfOptions = {},
): Promise<SaveOutcome> {
  return buildAndSave(
    () => buildClassPdf(arbeiten, options),
    options.title ?? CLASS_PDF_NAME,
    options,
  );
}
