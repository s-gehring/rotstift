import { canvasToBlob, createCanvas, drawRotated, get2dContext, releaseCanvas } from './canvas.ts';
import type { RgbaImage } from '../layout/types.ts';
import { decodeScaled, fitWithin, readImageSize, type ImageSize } from './image-decode.ts';
import { pixelsCanvas } from './straighten.ts';
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
  const size = await readImageSize(file);
  const bitmap = await decodeScaled(file, size, THUMBNAIL_EDGE);
  try {
    const canvas = createCanvas(bitmap.width, bitmap.height);
    drawRotated(get2dContext(canvas), bitmap, canvas, bitmap, 0);
    return await toThumbnail(canvas, size.width, size.height);
  } finally {
    bitmap.close();
  }
}

export async function pixelsThumbnail(image: RgbaImage, size: ImageSize): Promise<Thumbnail> {
  const source = pixelsCanvas(image);
  try {
    const target = fitWithin(image, THUMBNAIL_EDGE);
    const canvas = createCanvas(target.width, target.height);
    drawRotated(get2dContext(canvas), source, canvas, target, 0);
    return await toThumbnail(canvas, size.width, size.height);
  } finally {
    releaseCanvas(source);
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
