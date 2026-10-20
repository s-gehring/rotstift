import { encodePageImage } from '../export/page-image.ts';
import type { ExportPage, PageImageEncoder, WordCountArbeit } from '../export/types.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import { rotatedSize, type ImportPage } from '../import/pages.ts';
import { renderPageToPng } from '../import/render-page.ts';
import type { ArbeitResult } from './summary.ts';

export function createPdfInput(
  render: (page: ImportPage) => Promise<Blob> = renderPageToPng,
  encode: PageImageEncoder = encodePageImage,
) {
  const sources = new WeakMap<ExportPage, ImportPage>();

  const exportPage = (page: ImportPage): ExportPage => {
    const size = rotatedSize(page);
    const lazy: ExportPage = { image: new Blob(), width: size.width, height: size.height };
    sources.set(lazy, page);
    return lazy;
  };

  const encodePage: PageImageEncoder = async (page, profile) => {
    const source = sources.get(page);
    const image = source === undefined ? page.image : await render(source);
    return encode({ ...page, image }, profile);
  };

  const wordCountArbeit = (arbeit: Arbeit, result: ArbeitResult): WordCountArbeit => ({
    title: arbeit.name,
    pages: arbeit.pages.map(exportPage),
    words: arbeit.pages.map((page) => result.rows.find((row) => row.id === page.id)?.words ?? null),
  });

  return { wordCountArbeit, encodePage };
}
