import { PDFDocument, type PDFImage } from 'pdf-lib';
import { computeStatistics } from '../stats/statistics.ts';
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
}

async function createContext(title: string, options: ExportOptions): Promise<Context> {
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
    const encoded = await context.encodePage(page, profile);
    const image =
      encoded.format === 'jpeg'
        ? await context.doc.embedJpg(encoded.bytes)
        : await context.doc.embedPng(encoded.bytes);
    drawFitted(context.doc, image);
  }
}

function pageWords(page: ExportPage): number | undefined {
  return page.transcript === undefined ? undefined : computeStatistics(page.transcript).words;
}

function totalWords(pages: readonly ExportPage[]): number {
  return pages.reduce((sum, page) => sum + (pageWords(page) ?? 0), 0);
}

async function appendCorrected(context: Context, arbeit: CorrectedArbeit): Promise<void> {
  requirePages(arbeit);
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
  await appendPages(context, arbeit.pages, undefined);
  drawWordCountPage(context.doc, context.fonts, {
    title: arbeit.title,
    words: arbeit.pages.map(pageWords),
    date: context.date,
  });
}

export async function buildCorrectedPdf(
  input: CorrectedArbeit,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const context = await createContext(input.title, options);
  await appendCorrected(context, input);
  return context.doc.save();
}

export async function buildWordCountPdf(
  input: WordCountArbeit,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const context = await createContext(input.title, options);
  await appendWordCount(context, input);
  return context.doc.save();
}

function coverEntry(arbeit: ClassArbeit): CoverEntry {
  return arbeit.kind === 'corrected'
    ? {
        name: arbeit.title,
        pages: arbeit.pages.length,
        words: arbeit.statistics.words,
        errors: arbeit.statistics.errors,
      }
    : {
        name: arbeit.title,
        pages: arbeit.pages.length,
        words: totalWords(arbeit.pages),
        errors: undefined,
      };
}

export async function buildClassPdf(
  arbeiten: readonly ClassArbeit[],
  options: ClassExportOptions = {},
): Promise<Uint8Array> {
  if (arbeiten.length === 0) throw new RangeError('Für die Klasse gibt es keine Arbeiten.');
  const title = options.title ?? 'Alle Arbeiten';
  const context = await createContext(title, options);
  drawCoverPage(context.doc, context.fonts, {
    title,
    entries: arbeiten.map(coverEntry),
    date: context.date,
  });
  for (const arbeit of arbeiten) {
    if (arbeit.kind === 'corrected') await appendCorrected(context, arbeit);
    else await appendWordCount(context, arbeit);
  }
  return context.doc.save();
}
