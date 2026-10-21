import { useEffect, useState } from 'react';
import type { ImportPage } from '../import/pages.ts';
import { renderPageToPng } from '../import/render-page.ts';
import { useObjectUrl } from './page-image.ts';
import type { ReviewImage } from './review-flow.ts';

const DISPLAY_EDGE = 1800;

interface Rendered {
  readonly page: ImportPage;
  readonly blob: Blob;
}

export function usePageImage(
  page: ImportPage,
  image: ReviewImage | null,
  visible: boolean,
): string | null {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const needed = image === null && visible && rendered?.page !== page;
  useEffect(() => {
    if (!needed) return undefined;
    let current = true;
    renderPageToPng(page, { maxEdge: DISPLAY_EDGE }).then(
      (blob) => {
        if (current) setRendered({ page, blob });
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [needed, page]);
  const own = rendered?.page === page ? rendered.blob : null;
  return useObjectUrl(image?.blob ?? own);
}
