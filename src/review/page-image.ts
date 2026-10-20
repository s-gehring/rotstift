import { useEffect, useMemo } from 'react';
import { canvasToBlob, createCanvas, get2dContext, releaseCanvas } from '../import/canvas.ts';
import type { ImportPage } from '../import/pages.ts';
import { renderPageToPng } from '../import/render-page.ts';
import type { ReviewImage } from './review-flow.ts';

export const JPEG_QUALITY = 0.9;

export async function loadPageImage(page: ImportPage): Promise<ReviewImage> {
  const png = await renderPageToPng(page);
  const bitmap = await createImageBitmap(png);
  const canvas = createCanvas(bitmap.width, bitmap.height);
  try {
    const context = get2dContext(canvas);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    bitmap.close();
    releaseCanvas(canvas);
  }
}

interface SharedUrl {
  readonly url: string;
  users: number;
}

const shared = new Map<Blob, SharedUrl>();

function urlFor(blob: Blob): SharedUrl {
  let entry = shared.get(blob);
  if (entry === undefined) {
    entry = { url: URL.createObjectURL(blob), users: 0 };
    shared.set(blob, entry);
  }
  return entry;
}

function releaseLater(blob: Blob) {
  setTimeout(() => {
    const entry = shared.get(blob);
    if (entry === undefined || entry.users > 0) return;
    shared.delete(blob);
    URL.revokeObjectURL(entry.url);
  }, 0);
}

export function useObjectUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob === null ? null : urlFor(blob).url), [blob]);
  useEffect(() => {
    if (blob === null) return undefined;
    const entry = urlFor(blob);
    entry.users += 1;
    return () => {
      entry.users -= 1;
      if (entry.users === 0) releaseLater(blob);
    };
  }, [blob]);
  return url;
}

export function sharedUrlCount(): number {
  return shared.size;
}
