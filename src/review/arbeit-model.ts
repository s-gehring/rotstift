import type { Transcript } from '../annotations/transcript.ts';
import type { HintStatus, ReadingHint } from '../correction/uncertain-reading.ts';
import type { Arbeit } from '../import/arbeiten.ts';
import type { ImportPage } from '../import/pages.ts';
import { markKey } from '../overlay/AnnotatedPage.tsx';
import { markText } from '../overlay/hint-layout.ts';
import { isOutdated } from '../pipeline/runner.ts';
import { describeError } from '../pipeline/transcriber.ts';
import { buildResults } from '../results/summary.ts';
import type { CommentKind } from '../content-form/catalog.ts';
import { coveringMark } from '../content-form/overlap.ts';
import { summaryText } from '../content-form/review.ts';
import type { PageComment } from '../overlay/layout.ts';
import type { CommentStatus, ReviewImage, ReviewState, WorkReview } from './review-flow.ts';
import type { Weighting } from '../stats/weighting.ts';
import { pageCondition, summarizeArbeit, weighArbeit, type Entries } from './summary.ts';

export interface MarkEntry {
  readonly key: string;
  readonly type: string;
  readonly text: string;
}

export interface HintEntry {
  readonly index: number;
  readonly status: HintStatus;
  readonly text: string;
}

export interface PageCorrection {
  readonly transcript: Transcript;
  readonly readingHints: readonly ReadingHint[];
  readonly hints: readonly HintEntry[];
  readonly marks: readonly MarkEntry[];
  readonly errors: number;
  readonly comments: readonly PageComment[];
  readonly summary: string | null;
}

export interface CommentEntry {
  readonly index: number;
  readonly status: CommentStatus;
  readonly kind: CommentKind;
  readonly text: string;
  readonly page: number;
  readonly line: number;
  readonly coveredBy: string | null;
}

export interface ContentReviewModel {
  readonly status: WorkReview['status'];
  readonly comments: readonly CommentEntry[];
  readonly summary: string | null;
  readonly message: string | null;
  readonly checkedAs: string | null;
}

export type PageActivity = 'reading' | 'correcting' | null;

export interface PageModel {
  readonly page: ImportPage;
  readonly position: number;
  readonly words: number | null;
  readonly text: string | null;
  readonly editable: boolean;
  readonly edited: boolean;
  readonly activity: PageActivity;
  readonly problem: string | null;
  readonly empty: boolean;
  readonly open: boolean;
  readonly warning: string | null;
  readonly image: ReviewImage | null;
  readonly correction: PageCorrection | null;
}

export interface ArbeitFigures {
  readonly words: number | null;
  readonly errors: number | null;
  readonly weighted: number | null;
  readonly quotient: number | null;
  readonly partial: boolean;
}

export interface ArbeitModel {
  readonly corrected: boolean;
  readonly pages: readonly PageModel[];
  readonly figures: ArbeitFigures;
  readonly openHints: number;
  readonly content: ContentReviewModel | null;
}

const CANCELLED = 'Abgebrochen.';

export function markEntries(transcript: Transcript): MarkEntry[] {
  return transcript.lines.flatMap((line) =>
    line.marks.map((mark, index) => ({
      key: markKey(line.number, index),
      type: mark.type,
      text: markText(mark),
    })),
  );
}

function unplacedText(lines: readonly number[]): string | null {
  if (lines.length === 0) return null;
  return lines.length === 1
    ? `Zeile ${lines[0]} nicht auf der Seite gefunden`
    : `Zeilen ${lines.join(', ')} nicht auf der Seite gefunden`;
}

export function contentReview(arbeit: Arbeit, review: ReviewState): ContentReviewModel | null {
  const work = review.works[arbeit.id];
  if (work === undefined) return null;
  const current = arbeit.pages.map((page) => review.pages[page.id]?.source ?? null);
  const matches =
    current.length === work.sources.length &&
    current.every((source, index) => source === work.sources[index]);
  if (!matches) return null;
  const comments = work.comments.flatMap((comment, index): CommentEntry[] => {
    const position = arbeit.pages.findIndex((page) => page.id === comment.pageId);
    if (position < 0) return [];
    const transcript = review.pages[comment.pageId]?.result?.transcript;
    const coveredBy =
      transcript === undefined || review.profile === null
        ? null
        : coveringMark(comment, transcript, review.profile);
    return [
      {
        index,
        status: comment.status,
        kind: comment.kind,
        text: comment.text,
        page: position + 1,
        line: comment.line,
        coveredBy,
      },
    ];
  });
  return {
    status: work.status,
    comments,
    summary: summaryText(comments.filter((comment) => comment.status === 'open')),
    message: work.message,
    checkedAs: work.checkedAs ?? null,
  };
}

export function buildArbeitModel(
  arbeit: Arbeit,
  review: ReviewState,
  entries: Entries,
  weighting: Weighting | null = null,
): ArbeitModel {
  const corrected = arbeit.pages.some((page) => review.pages[page.id] !== undefined);
  const result = buildResults([arbeit], entries)[0];
  const content = corrected ? contentReview(arbeit, review) : null;
  const summaryPage = arbeit.pages.findLast(
    (page) => review.pages[page.id]?.result != null && review.pages[page.id]?.status === 'done',
  )?.id;
  const pages = arbeit.pages.map((page, index): PageModel => {
    const entry = entries[page.id];
    const reviewPage = corrected ? review.pages[page.id] : undefined;
    const condition = corrected ? pageCondition(page, reviewPage, entries) : null;
    const words = result?.rows.find((row) => row.id === page.id)?.words ?? null;
    const pageResult = condition === 'corrected' ? (reviewPage?.result ?? null) : null;
    const image =
      reviewPage?.image != null && reviewPage.rotation === page.rotation ? reviewPage.image : null;

    let activity: PageActivity = entry?.status === 'running' ? 'reading' : null;
    if (reviewPage?.status === 'transcribing') activity = 'reading';
    else if (reviewPage?.status === 'locating' || reviewPage?.status === 'correcting') {
      activity = 'correcting';
    }

    let problem: string | null = null;
    if (condition === 'problem' && reviewPage !== undefined) {
      problem = reviewPage.status === 'cancelled' ? CANCELLED : reviewPage.message;
    } else if (!corrected && entry?.error != null) {
      problem = describeError(entry.error);
    }

    let correction: PageCorrection | null = null;
    if (pageResult !== null) {
      correction = {
        transcript: pageResult.transcript,
        readingHints: pageResult.hints,
        hints: pageResult.hints.map((hint, hintIndex) => ({
          index: hintIndex,
          status: hint.status,
          text: markText(hint.mark),
        })),
        marks: markEntries(pageResult.transcript),
        errors: pageResult.statistics.errors,
        comments:
          content?.comments
            .filter(
              (comment) =>
                comment.status === 'open' &&
                comment.coveredBy === null &&
                comment.page === index + 1,
            )
            .map(({ line, text }) => ({ line, text })) ?? [],
        summary: page.id === summaryPage ? (content?.summary ?? null) : null,
      };
    }

    const warning =
      pageResult === null
        ? null
        : (reviewPage?.warning?.text ?? unplacedText(pageResult.unplacedLines));
    const empty = corrected
      ? condition === 'empty'
      : entry?.status === 'done' && entry.hasTranscript && entry.text.trim() === '';
    const open = corrected
      ? condition === 'stale' || (condition === 'open' && activity === null)
      : entry !== undefined && isOutdated(entry, page);

    return {
      page,
      position: index + 1,
      words,
      text: entry?.hasTranscript === true ? entry.text : null,
      editable: entry?.status === 'done' && entry.hasTranscript,
      edited: entry?.edited === true && entry.hasTranscript,
      activity,
      problem,
      empty,
      open,
      warning,
      image,
      correction,
    };
  });

  let figures: ArbeitFigures;
  if (corrected) {
    const summary = summarizeArbeit(arbeit, review, entries);
    const weighted =
      review.profile === null || weighting === null
        ? null
        : weighArbeit(summary, review.profile, weighting);
    figures = {
      words: summary.statistics?.words ?? null,
      errors: summary.statistics?.errors ?? null,
      weighted: weighted?.weighted ?? null,
      quotient: weighted?.quotient ?? null,
      partial: !summary.complete,
    };
  } else {
    figures = {
      words: result === undefined || result.countedPages === 0 ? null : result.words,
      errors: null,
      weighted: null,
      quotient: null,
      partial: result !== undefined && result.countedPages < result.pageCount,
    };
  }

  const openHints = pages.reduce(
    (sum, page) =>
      sum + (page.correction?.hints.filter((hint) => hint.status === 'open').length ?? 0),
    0,
  );
  const stale = pages.some((page) => page.open);
  return { corrected, pages, figures, openHints, content: stale ? null : content };
}
