import { canvasToBlob, createCanvas, get2dContext, releaseCanvas } from './canvas.ts';
import { getPdfPage } from './pdf-documents.ts';

const THUMBNAIL_EDGE = 320;

export interface Thumbnail {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

async function toThumbnail(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): Promise<Thumbnail> {
  try {
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    return { url: URL.createObjectURL(blob), width, height };
  } finally {
    releaseCanvas(canvas);
  }
}

export async function imageThumbnail(file: File): Promise<Thumbnail> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = createCanvas(bitmap.width * scale, bitmap.height * scale);
    const context = get2dContext(canvas);
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await toThumbnail(canvas, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

export async function pdfThumbnail(documentId: string, pageNumber: number): Promise<Thumbnail> {
  const page = await getPdfPage(documentId, pageNumber);
  try {
    const unit = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: THUMBNAIL_EDGE / Math.max(unit.width, unit.height),
    });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas, viewport, background: '#fff' }).promise;
    return await toThumbnail(canvas, unit.width, unit.height);
  } finally {
    page.cleanup();
  }
}
