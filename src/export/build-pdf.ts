import type {
  ClassArbeit,
  ClassExportOptions,
  CorrectedArbeit,
  ExportOptions,
  WordCountArbeit,
} from './types.ts';

const load = () => import('./builders.ts');

export async function buildCorrectedPdf(
  input: CorrectedArbeit,
  options?: ExportOptions,
): Promise<Uint8Array> {
  return (await load()).buildCorrectedPdf(input, options);
}

export async function buildWordCountPdf(
  input: WordCountArbeit,
  options?: ExportOptions,
): Promise<Uint8Array> {
  return (await load()).buildWordCountPdf(input, options);
}

export async function buildClassPdf(
  arbeiten: readonly ClassArbeit[],
  options?: ClassExportOptions,
): Promise<Uint8Array> {
  return (await load()).buildClassPdf(arbeiten, options);
}
