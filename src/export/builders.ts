import { PDFDocument, type PDFImage } from 'pdf-lib';
import { listErrors } from '../annotations/transcript.ts';
import { computeStatistics } from '../stats/statistics.ts';
import { incompleteArbeitenNote, incompletePagesNote } from './notes.ts';
import { encodePageImage } from './page-image.ts';
import { A4, embedFonts, type Fonts } from './sheet.ts';
import {
  drawCoverPage,
  drawStatisticsPage,
  drawWordCountPage,
  type CoverEntry,
} from './summary-pages.ts';
import type {
  ClassArbeit,
  ClassExportOptions,
  CorrectedArbeit,
  ExportOptions,
  ExportPage,
  PageImageEncoder,
  WordCountArbeit,
} from './types.ts';

interface Context {
  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  readonly date: Date;
  readonly encodePage: PageImageEncoder;
  readonly signal: AbortSignal | undefined;
  readonly onProgress: ((done: number, total: number) => void) | undefined;
  readonly total: number;
  done: number;
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function createContext(
  title: string,
  total: number,
  options: ExportOptions,
): Promise<Context> {
  const date = options.date ?? new Date();
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setCreator('Rotstift');
  doc.setProducer('Rotstift');
  doc.setLanguage('de-DE');
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  return {
    doc,
    fonts: await embedFonts(doc),
    date,
    encodePage: options.encodePage ?? encodePageImage,
    signal: options.signal,
    onProgress: options.onProgress,
    total,
    done: 0,
  };
}

function requirePages(arbeit: { readonly title: string; readonly pages: readonly ExportPage[] }) {
  if (arbeit.pages.length === 0) {
    throw new RangeError(`Die Arbeit „${arbeit.title}“ hat keine Seiten.`);
  }
}

function drawFitted(doc: PDFDocument, image: PDFImage): void {
  const landscape = image.width > image.height;
  const sheet = landscape ? { width: A4.height, height: A4.width } : A4;
  const scale = Math.min(sheet.width / image.width, sheet.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  doc.addPage([sheet.width, sheet.height]).drawImage(image, {
    x: (sheet.width - width) / 2,
    y: (sheet.height - height) / 2,
    width,
    height,
  });
}

async function appendPages(
  context: Context,
  pages: readonly ExportPage[],
  profile: CorrectedArbeit['profile'] | undefined,
): Promise<void> {
  for (const page of pages) {
    context.signal?.throwIfAborted();
    const encoded = await context.encodePage(page, profile);
    const image =
      encoded.format === 'jpeg'
        ? await context.doc.embedJpg(encoded.bytes)
        : await context.doc.embedPng(encoded.bytes);
    drawFitted(context.doc, image);
    context.done += 1;
    context.onProgress?.(context.done, context.total);
    await yieldToEventLoop();
  }
  context.signal?.throwIfAborted();
}

function pageWords(page: ExportPage): number | undefined {
  return page.transcript === undefined ? undefined : computeStatistics(page.transcript).words;
}

function totalWords(pages: readonly ExportPage[]): number {
  return pages.reduce((sum, page) => sum + (pageWords(page) ?? 0), 0);
}

interface WordSummary {
  readonly words: readonly (number | undefined)[];
  readonly total: number | undefined;
  readonly note: string | undefined;
}

function summarizeWords(arbeit: WordCountArbeit): WordSummary {
  const { pages } = arbeit;
  if (arbeit.words !== undefined && arbeit.words.length !== pages.length) {
    throw new RangeError(`Die Wortzahlen der Arbeit „${arbeit.title}“ passen nicht zu den Seiten.`);
  }
  const words = arbeit.words?.map((count) => count ?? undefined) ?? pages.map(pageWords);
  const counted = words.filter((count) => count !== undefined).length;
  const complete = counted === pages.length;
  return {
    words,
    total: complete ? words.reduce<number>((sum, count) => sum + (count ?? 0), 0) : undefined,
    note: complete ? undefined : incompletePagesNote(counted, pages.length),
  };
}

function requireConsistentStatistics(arbeit: CorrectedArbeit): void {
  const transcripts = arbeit.pages.flatMap((page) => (page.transcript ? [page.transcript] : []));
  const errors = transcripts.flatMap(listErrors);
  const byType = new Map<string, number>();
  for (const error of errors) byType.set(error.type, (byType.get(error.type) ?? 0) + 1);
  const { statistics } = arbeit;
  const sameTypes =
    Object.keys(statistics.errorsByType).length === byType.size &&
    [...byType].every(([type, count]) => statistics.errorsByType[type] === count);
  const words = totalWords(arbeit.pages);
  const hyphenations = arbeit.pages.length - 1;
  const plausibleWords = statistics.words <= words && statistics.words >= words - hyphenations;
  if (statistics.errors !== errors.length || !sameTypes || !plausibleWords) {
    throw new RangeError(
      `Die Statistik der Arbeit „${arbeit.title}“ passt nicht zu den Transkripten der Seiten.`,
    );
  }
}

async function appendCorrected(context: Context, arbeit: CorrectedArbeit): Promise<void> {
  requirePages(arbeit);
  requireConsistentStatistics(arbeit);
  await appendPages(context, arbeit.pages, arbeit.profile);
  drawStatisticsPage(context.doc, context.fonts, {
    title: arbeit.title,
    profile: arbeit.profile,
    statistics: arbeit.statistics,
    date: context.date,
  });
}

async function appendWordCount(context: Context, arbeit: WordCountArbeit): Promise<void> {
  requirePages(arbeit);
  const summary = summarizeWords(arbeit);
  await appendPages(context, arbeit.pages, undefined);
  drawWordCountPage(context.doc, context.fonts, {
    title: arbeit.title,
    ...summary,
    date: context.date,
  });
}

export async function buildCorrectedPdf(
  input: CorrectedArbeit,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const context = await createContext(input.title, input.pages.length, options);
  await appendCorrected(context, input);
  return context.doc.save();
}

export async function buildWordCountPdf(
  input: WordCountArbeit,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const context = await createContext(input.title, input.pages.length, options);
  await appendWordCount(context, input);
  return context.doc.save();
}

function coverEntry(arbeit: ClassArbeit): CoverEntry {
  if (arbeit.kind === 'corrected') {
    return {
      name: arbeit.title,
      pages: arbeit.pages.length,
      words: arbeit.statistics.words,
      errors: arbeit.statistics.errors,
    };
  }
  const summary = summarizeWords(arbeit);
  return {
    name: arbeit.title,
    pages: arbeit.pages.length,
    words: summary.total,
    errors: undefined,
    ...(summary.note !== undefined && { note: summary.note }),
  };
}

function coverTotal(entries: readonly CoverEntry[]): CoverEntry {
  const complete = entries.filter((entry) => entry.words !== undefined).length;
  const sum = (field: 'words' | 'errors') =>
    entries.every((entry) => entry[field] !== undefined)
      ? entries.reduce((total, entry) => total + (entry[field] ?? 0), 0)
      : undefined;
  return {
    name: 'Gesamt',
    pages: entries.reduce((total, entry) => total + entry.pages, 0),
    words: sum('words'),
    errors: sum('errors'),
    ...(complete < entries.length && { note: incompleteArbeitenNote(complete, entries.length) }),
  };
}

export async function buildClassPdf(
  arbeiten: readonly ClassArbeit[],
  options: ClassExportOptions = {},
): Promise<Uint8Array> {
  if (arbeiten.length === 0) throw new RangeError('Für die Klasse gibt es keine Arbeiten.');
  const title = options.title ?? 'Alle Arbeiten';
  const total = arbeiten.reduce((sum, arbeit) => sum + arbeit.pages.length, 0);
  const context = await createContext(title, total, options);
  const entries = arbeiten.map(coverEntry);
  drawCoverPage(context.doc, context.fonts, {
    title,
    entries,
    total: coverTotal(entries),
    date: context.date,
  });
  for (const arbeit of arbeiten) {
    if (arbeit.kind === 'corrected') await appendCorrected(context, arbeit);
    else await appendWordCount(context, arbeit);
  }
  return context.doc.save();
}
