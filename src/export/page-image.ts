import type { CorrectionProfile } from '../annotations/profile.ts';
import { canvasToBlob, createCanvas, get2dContext, releaseCanvas } from '../import/canvas.ts';
import { drawOverlay } from '../overlay/draw-canvas.ts';
import { ensureOverlayFont } from '../overlay/font.ts';
import { layoutOverlay } from '../overlay/layout.ts';
import type { OverlayModel } from '../overlay/model.ts';
import type { ExportPage, PageImage } from './types.ts';

export const MAX_EDGE = 2048;
export const JPEG_QUALITY = 0.82;

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function layoutMarks(
  page: ExportPage,
  profile: CorrectionProfile | undefined,
): OverlayModel | null {
  if (profile === undefined || page.transcript === undefined) return null;
  const model = layoutOverlay(page.transcript, {
    page: { width: page.width, height: page.height },
    profile,
  });
  return model.items.length > 0 ? model : null;
}

export async function encodePageImage(
  page: ExportPage,
  profile: CorrectionProfile | undefined,
  maxEdge = MAX_EDGE,
): Promise<PageImage> {
  const model = layoutMarks(page, profile);
  const source = new Uint8Array(await page.image.arrayBuffer());
  const longEdge = Math.max(page.width, page.height);
  if (model === null && isJpeg(source) && longEdge <= maxEdge) {
    return { bytes: source, format: 'jpeg' };
  }
  if (model !== null) await ensureOverlayFont();
  const scale = Math.min(1, maxEdge / longEdge);
  const bitmap = await createImageBitmap(page.image);
  const canvas = createCanvas(page.width * scale, page.height * scale);
  try {
    const context = get2dContext(canvas);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.scale(canvas.width / page.width, canvas.height / page.height);
    context.drawImage(bitmap, 0, 0, page.width, page.height);
    if (model !== null) drawOverlay(context, model);
    const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'jpeg' };
  } finally {
    bitmap.close();
    releaseCanvas(canvas);
  }
}
