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
import type { Grading } from '../stats/grading.ts';
import type { Weighting } from '../stats/weighting.ts';
import { contentReview } from './arbeit-model.ts';
import type { ReviewState } from './review-flow.ts';
import { pageCondition, summarizeArbeit, type Entries } from './summary.ts';

export interface Rating {
  readonly weighting: Weighting;
  readonly grading: Grading;
}

export const PDF_FOOTER = 'Vorschau: automatisch erstellte Korrektur, bitte prüfen';

export function createReviewExport(
  render: (page: ImportPage) => Promise<Blob> = renderPageToPng,
  encode: PageImageEncoder = encodePageImage,
) {
  const sources = new WeakMap<ExportPage, ImportPage>();

  const exportPage = (
    page: ImportPage,
    state: ReviewState,
    entries: Entries,
    notes: Pick<ExportPage, 'comments' | 'summary'>,
  ): ExportPage => {
    const review = state.pages[page.id];
    const corrected = pageCondition(page, review, entries) === 'corrected';
    const transcript = corrected ? review?.result?.transcript : undefined;
    const image = corrected ? review?.image : null;
    const marks = transcript && { transcript, ...notes };
    if (image) {
      return { image: image.blob, width: image.width, height: image.height, ...marks };
    }
    const size = rotatedSize(page);
    const lazy: ExportPage = {
      image: new Blob(),
      width: size.width,
      height: size.height,
      ...marks,
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
    { weighting, grading }: Rating,
  ): CorrectedArbeit | null => {
    const summary = summarizeArbeit(arbeit, state, entries);
    if (!summary.complete || summary.preview || summary.statistics === null) return null;
    const review = contentReview(arbeit, state);
    const comments =
      review?.status === 'done'
        ? review.comments.filter((comment) => comment.status === 'open')
        : [];
    const last = arbeit.pages.findLast(
      (page) => pageCondition(page, state.pages[page.id], entries) === 'corrected',
    );
    return {
      title: arbeit.name,
      pages: arbeit.pages.map((page, index) =>
        exportPage(page, state, entries, {
          comments: comments
            .filter((comment) => comment.page === index + 1 && comment.coveredBy === null)
            .map(({ line, text }) => ({ line, text })),
          summary: page === last ? (review?.summary ?? null) : null,
        }),
      ),
      profile,
      statistics: summary.statistics,
      weighting,
      grading,
      ...(review?.status === 'done' && {
        content: {
          comments: comments.map(({ page, line, text, coveredBy }) => ({
            page,
            line,
            text,
            ...(coveredBy !== null && { coveredBy }),
          })),
          summary: review.summary,
        },
      }),
    };
  };

  const classArbeiten = (
    arbeiten: readonly Arbeit[],
    state: ReviewState,
    entries: Entries,
    profile: CorrectionProfile,
    rating: Rating,
  ): ClassArbeit[] =>
    arbeiten.flatMap((arbeit) => {
      const corrected = correctedArbeit(arbeit, state, entries, profile, rating);
      return corrected === null ? [] : [{ kind: 'corrected' as const, ...corrected }];
    });

  return { correctedArbeit, classArbeiten, encodePage };
}

export type ReviewExport = ReturnType<typeof createReviewExport>;
