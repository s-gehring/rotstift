import { canvasToBlob, createCanvas, get2dContext, releaseCanvas } from './canvas.ts';
import { getPdfPage } from './pdf-documents.ts';
import { rotatedSize, type ImportPage } from './pages.ts';

export const DEFAULT_MAX_EDGE = 2048;

export interface RenderOptions {
  /** Longest edge of the result in pixels. Images are never upscaled, PDF pages are rendered to this size. */
  readonly maxEdge?: number;
}

/** Renders one page with its rotation applied as a PNG. Renders on demand, nothing is cached. */
export async function renderPageToPng(
  page: ImportPage,
  options: RenderOptions = {},
): Promise<Blob> {
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  if (!(maxEdge > 0)) throw new RangeError('maxEdge muss größer als 0 sein.');
  const canvas =
    page.source.kind === 'image'
      ? await drawImage(page.source.file, page, maxEdge)
      : await drawPdfPage(page.source.documentId, page.source.pageNumber, page, maxEdge);
  try {
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    releaseCanvas(canvas);
  }
}

async function drawImage(
  file: File,
  page: ImportPage,
  maxEdge: number,
): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    const size = rotatedSize({ width, height, rotation: page.rotation });
    const canvas = createCanvas(size.width, size.height);
    const context = get2dContext(canvas);
    context.imageSmoothingQuality = 'high';
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((page.rotation * Math.PI) / 180);
    context.drawImage(bitmap, -width / 2, -height / 2, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

async function drawPdfPage(
  documentId: string,
  pageNumber: number,
  page: ImportPage,
  maxEdge: number,
): Promise<HTMLCanvasElement> {
  const pdfPage = await getPdfPage(documentId, pageNumber);
  try {
    const rotation = (pdfPage.rotate + page.rotation) % 360;
    const unit = pdfPage.getViewport({ scale: 1, rotation });
    const scale = maxEdge / Math.max(unit.width, unit.height);
    const viewport = pdfPage.getViewport({ scale, rotation });
    const canvas = createCanvas(viewport.width, viewport.height);
    await pdfPage.render({ canvas, viewport }).promise;
    return canvas;
  } finally {
    pdfPage.cleanup();
  }
}
