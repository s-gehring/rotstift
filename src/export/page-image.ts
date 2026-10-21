import type { CorrectionProfile } from '../annotations/profile.ts';
import { rasterizeAnnotatedPage } from '../overlay/draw-canvas.ts';
import { layoutOverlay } from '../overlay/layout.ts';
import type { OverlayModel } from '../overlay/model.ts';
import type { ExportPage, PageImage } from './types.ts';

export const MAX_EDGE = 2048;
export const JPEG_QUALITY = 0.82;

const ASPECT_TOLERANCE = 0.01;

function layoutMarks(page: ExportPage, profile: CorrectionProfile | undefined): OverlayModel {
  const size = { width: page.width, height: page.height };
  if (profile === undefined || page.transcript === undefined) {
    return { page: size, items: [], skippedLines: [] };
  }
  return layoutOverlay(page.transcript, {
    page: size,
    profile,
    ...(page.comments && { comments: page.comments }),
    summary: page.summary ?? null,
  });
}

function requireMatchingAspect(page: ExportPage, bitmap: ImageBitmap): void {
  const expected = page.width / page.height;
  const actual = bitmap.width / bitmap.height;
  if (Math.abs(actual / expected - 1) > ASPECT_TOLERANCE) {
    throw new RangeError(
      `Die Seitenmaße ${page.width} × ${page.height} passen nicht zum Bild (${bitmap.width} × ${bitmap.height}).`,
    );
  }
}

export async function encodePageImage(
  page: ExportPage,
  profile: CorrectionProfile | undefined,
  maxEdge = MAX_EDGE,
): Promise<PageImage> {
  const model = layoutMarks(page, profile);
  const bitmap = await createImageBitmap(page.image);
  try {
    requireMatchingAspect(page, bitmap);
    const blob = await rasterizeAnnotatedPage({
      image: bitmap,
      model,
      type: 'image/jpeg',
      quality: JPEG_QUALITY,
      maxEdge,
    });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'jpeg' };
  } finally {
    bitmap.close();
  }
}
