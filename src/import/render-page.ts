import { canvasToBlob, createCanvas, drawRotated, get2dContext, releaseCanvas } from './canvas.ts';
import { decodeScaled, readImageSize } from './image-decode.ts';
import { getPdfPage } from './pdf-documents.ts';
import { rotatedSize, type ImportPage } from './pages.ts';
import { drawStraight } from './straighten.ts';

export const DEFAULT_MAX_EDGE = 2048;

export interface RenderOptions {
  readonly maxEdge?: number;
}

export async function renderPageToPng(
  page: ImportPage,
  options: RenderOptions = {},
): Promise<Blob> {
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
  if (!(maxEdge > 0)) throw new RangeError('maxEdge muss größer als 0 sein.');
  const { source } = page;
  const canvas =
    source.kind === 'pdf'
      ? await drawPdfPage(source.documentId, source.pageNumber, page, maxEdge)
      : source.dewarp === undefined
        ? await drawImage(source.file, page.rotation, maxEdge)
        : await drawStraight(source.file, source.dewarp, page.rotation, maxEdge);
  try {
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    releaseCanvas(canvas);
  }
}

async function drawImage(
  file: File,
  rotation: ImportPage['rotation'],
  maxEdge: number,
): Promise<HTMLCanvasElement> {
  const bitmap = await decodeScaled(file, await readImageSize(file), maxEdge);
  try {
    const size = rotatedSize({ width: bitmap.width, height: bitmap.height, rotation });
    const canvas = createCanvas(size.width, size.height);
    drawRotated(get2dContext(canvas), bitmap, canvas, bitmap, rotation);
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
    await pdfPage.render({ canvas, viewport, background: '#fff' }).promise;
    return canvas;
  } finally {
    pdfPage.cleanup();
  }
}
