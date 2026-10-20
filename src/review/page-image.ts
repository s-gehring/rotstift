import type { ImportPage } from '../import/pages.ts';
import { renderPageToPng } from '../import/render-page.ts';
import type { PageImage } from './review-flow.ts';

export async function loadPageImage(page: ImportPage): Promise<PageImage> {
  const blob = await renderPageToPng(page);
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  return { blob, url: URL.createObjectURL(blob), width, height };
}

export function releasePageImage(image: PageImage): void {
  URL.revokeObjectURL(image.url);
}
