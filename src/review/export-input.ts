import type { CorrectionProfile } from '../annotations/profile.ts';
import { encodePageImage } from '../export/page-image.ts';
import type {
  ClassArbeit,
  CorrectedArbeit,
  ExportPage,
  PageImageEncoder,
} from '../export/types.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import { rotatedSize, type ImportPage } from '../import/pages.ts';
import { renderPageToPng } from '../import/render-page.ts';
import type { ReviewState } from './review-flow.ts';
import { pageCondition, summarizeArbeit, type Entries } from './summary.ts';

export const PDF_FOOTER = 'Vorschau: automatisch erstellte Korrektur, bitte prüfen';

export function createReviewExport(
  render: (page: ImportPage) => Promise<Blob> = renderPageToPng,
  encode: PageImageEncoder = encodePageImage,
) {
  const sources = new WeakMap<ExportPage, ImportPage>();

  const exportPage = (page: ImportPage, state: ReviewState, entries: Entries): ExportPage => {
    const review = state.pages[page.id];
    const corrected = pageCondition(page, review, entries) === 'corrected';
    const transcript = corrected ? review?.result?.transcript : undefined;
    const image = corrected ? review?.image : null;
    if (image) {
      return {
        image: image.blob,
        width: image.width,
        height: image.height,
        ...(transcript && { transcript }),
      };
    }
    const size = rotatedSize(page);
    const lazy: ExportPage = {
      image: new Blob(),
      width: size.width,
      height: size.height,
      ...(transcript && { transcript }),
    };
    sources.set(lazy, page);
    return lazy;
  };

  const encodePage: PageImageEncoder = async (page, profile) => {
    const source = sources.get(page);
    const image = source === undefined ? page.image : await render(source);
    return encode({ ...page, image }, profile);
  };

  const correctedArbeit = (
    arbeit: Arbeit,
    state: ReviewState,
    entries: Entries,
    profile: CorrectionProfile,
  ): CorrectedArbeit | null => {
    const summary = summarizeArbeit(arbeit, state, entries);
    if (!summary.complete || summary.preview || summary.statistics === null) return null;
    return {
      title: arbeit.name,
      pages: arbeit.pages.map((page) => exportPage(page, state, entries)),
      profile,
      statistics: summary.statistics,
    };
  };

  const classArbeiten = (
    arbeiten: readonly Arbeit[],
    state: ReviewState,
    entries: Entries,
    profile: CorrectionProfile,
  ): ClassArbeit[] =>
    arbeiten.flatMap((arbeit) => {
      const corrected = correctedArbeit(arbeit, state, entries, profile);
      return corrected === null ? [] : [{ kind: 'corrected' as const, ...corrected }];
    });

  return { correctedArbeit, classArbeiten, encodePage };
}

export type ReviewExport = ReturnType<typeof createReviewExport>;
