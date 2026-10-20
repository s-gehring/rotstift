import type { Transcript } from '../annotations/transcript.ts';
import { encodePageImage } from '../export/page-image.ts';
import type { ExportPage, PageImageEncoder, WordCountArbeit } from '../export/types.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import { rotatedSize, type ImportPage } from '../import/pages.ts';
import { renderPageToPng } from '../import/render-page.ts';
import type { PageEntry } from '../pipeline/runner.ts';

function transcriptOf(entry: PageEntry | undefined): Transcript | undefined {
  if (entry === undefined || !entry.hasTranscript) return undefined;
  return {
    lines: entry.text.split('\n').map((text, index) => ({ number: index + 1, text, marks: [] })),
  };
}

export function createPdfInput(
  render: (page: ImportPage) => Promise<Blob> = renderPageToPng,
  encode: PageImageEncoder = encodePageImage,
) {
  const sources = new WeakMap<ExportPage, ImportPage>();

  const exportPage = (page: ImportPage, entry: PageEntry | undefined): ExportPage => {
    const size = rotatedSize(page);
    const lazy: ExportPage = {
      image: new Blob(),
      width: size.width,
      height: size.height,
      ...(entry?.hasTranscript ? { transcript: transcriptOf(entry) } : {}),
    };
    sources.set(lazy, page);
    return lazy;
  };

  const encodePage: PageImageEncoder = async (page, profile) => {
    const source = sources.get(page);
    const image = source === undefined ? page.image : await render(source);
    return encode({ ...page, image }, profile);
  };

  const wordCountArbeit = (
    arbeit: Arbeit,
    entries: Readonly<Record<string, PageEntry>>,
  ): WordCountArbeit => ({
    title: arbeit.name,
    pages: arbeit.pages.map((page) => exportPage(page, entries[page.id])),
  });

  return { wordCountArbeit, encodePage };
}
