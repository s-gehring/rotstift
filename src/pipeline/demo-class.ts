import { PDFDocument } from 'pdf-lib';
import { visibleText } from '../correction/correct-page.ts';
import { createCanvas, get2dContext, releaseCanvas } from '../import/canvas.ts';
import pageData from './demo-class/pages.json';

export interface DemoPage {
  readonly arbeit: string;
  readonly file: string;
  readonly lines: readonly string[];
  readonly corrected: readonly string[];
}

export type Signature = Uint8Array;

const GRID = { width: 48, height: 68 };
const MATCH_LIMIT = 4;

const urls = import.meta.glob<string>('./demo-class/*.jpg', {
  query: '?url',
  import: 'default',
  eager: true,
});

export const DEMO_PAGES: readonly DemoPage[] = pageData;

function urlOf(page: DemoPage): string {
  const url = urls[`./demo-class/${page.file}`];
  if (url === undefined) throw new Error(`Demo-Seite ${page.file} fehlt.`);
  return url;
}

export async function pageSignature(image: Blob): Promise<Signature> {
  const bitmap = await createImageBitmap(image);
  const canvas = createCanvas(GRID.width, GRID.height);
  try {
    const context = get2dContext(canvas);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let index = 0; index < gray.length; index += 1) {
      const at = index * 4;
      gray[index] = Math.round(
        0.299 * (data[at] ?? 0) + 0.587 * (data[at + 1] ?? 0) + 0.114 * (data[at + 2] ?? 0),
      );
    }
    return gray;
  } finally {
    bitmap.close();
    releaseCanvas(canvas);
  }
}

export function signatureDistance(a: Signature, b: Signature): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    sum += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }
  return sum / a.length;
}

export function matchSignature<T>(
  signature: Signature,
  known: readonly { readonly page: T; readonly signature: Signature }[],
  limit = MATCH_LIMIT,
): T | null {
  let best: T | null = null;
  let bestDistance = limit;
  for (const entry of known) {
    const distance = signatureDistance(signature, entry.signature);
    if (distance < bestDistance) {
      best = entry.page;
      bestDistance = distance;
    }
  }
  return best;
}

let knownSignatures: Promise<{ page: DemoPage; signature: Signature }[]> | null = null;

function loadKnown(): Promise<{ page: DemoPage; signature: Signature }[]> {
  knownSignatures ??= Promise.all(
    DEMO_PAGES.map(async (page) => {
      const response = await fetch(urlOf(page));
      return { page, signature: await pageSignature(await response.blob()) };
    }),
  ).catch((error: unknown) => {
    knownSignatures = null;
    throw error;
  });
  return knownSignatures;
}

export async function findDemoPage(png: Blob): Promise<DemoPage | null> {
  try {
    return matchSignature(await pageSignature(png), await loadKnown());
  } catch {
    return null;
  }
}

function key(lines: readonly string[]): string {
  return visibleText(lines).join('\n');
}

const corrections = new Map(DEMO_PAGES.map((page) => [key(page.lines), page.corrected]));

export function demoCorrection(lines: readonly string[]): string | null {
  const corrected = corrections.get(key(lines));
  return corrected === undefined ? null : corrected.join('\n');
}

async function imageFile(page: DemoPage): Promise<File> {
  const response = await fetch(urlOf(page));
  return new File([await response.blob()], `${page.arbeit}.jpg`, { type: 'image/jpeg' });
}

async function pdfFile(arbeit: string, pages: readonly DemoPage[]): Promise<File> {
  const document = await PDFDocument.create();
  for (const page of pages) {
    const response = await fetch(urlOf(page));
    const jpg = await document.embedJpg(await response.arrayBuffer());
    document.addPage([jpg.width, jpg.height]).drawImage(jpg, { x: 0, y: 0 });
  }
  const bytes = await document.save();
  return new File([bytes.slice().buffer], `${arbeit}.pdf`, { type: 'application/pdf' });
}

export async function demoClassFiles(): Promise<File[]> {
  const names = [...new Set(DEMO_PAGES.map((page) => page.arbeit))];
  return Promise.all(
    names.map((arbeit) => {
      const pages = DEMO_PAGES.filter((page) => page.arbeit === arbeit);
      const [only] = pages;
      return pages.length === 1 && only !== undefined ? imageFile(only) : pdfFile(arbeit, pages);
    }),
  );
}
