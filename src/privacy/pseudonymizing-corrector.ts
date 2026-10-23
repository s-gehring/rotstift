import type { ContentInput, ContentResult, WorkLine } from '../content-form/review.ts';
import type { CorrectResult, Corrector } from '../correction/corrector.ts';
import { DEFAULT_SCOPE, scopedProfile } from '../correction/scope.ts';
import { pseudonymizeWork, type PrivacyPage, type PseudonymizedPage } from './pseudonymize.ts';
import { restoreCorrection, restoreReview } from './restore.ts';

export interface PrivacyWorkPage extends PrivacyPage {
  readonly pageId: string;
}

export const PRIVACY_FAILED_MESSAGE = 'Der Personenbezug konnte nicht sicher entfernt werden';

const failed = { kind: 'failed', message: PRIVACY_FAILED_MESSAGE } as const;

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

export function withPseudonymization(
  inner: Corrector,
  pages: readonly PrivacyWorkPage[],
): Corrector {
  const work = pseudonymizeWork(pages);
  const byId = new Map<string, PseudonymizedPage>();
  pages.forEach((page, index) => {
    const pseudonymized = work.pages[index];
    if (pseudonymized !== undefined) byId.set(page.pageId, pseudonymized);
  });

  const sendLine = (line: WorkLine): WorkLine | null => {
    const page = byId.get(line.pageId);
    if (page?.original[line.line - 1] !== line.text) return null;
    return { ...line, text: page.lines[line.line - 1] ?? '' };
  };

  return {
    async correct(lines, profile, signal, scope): Promise<CorrectResult> {
      const page = work.pages.find((candidate) => sameLines(candidate.original, lines));
      if (page === undefined) return { ok: false, error: failed };
      const answer = await inner.correct(page.lines, profile, signal, scope);
      if (!answer.ok) return answer;
      const restored = restoreCorrection(
        page,
        answer.correctedText,
        scopedProfile(profile, scope ?? DEFAULT_SCOPE),
      );
      return restored === null
        ? { ok: false, error: failed }
        : { ok: true, correctedText: restored };
    },
    ...(inner.review !== undefined && {
      async review(input: ContentInput, signal: AbortSignal): Promise<ContentResult> {
        const lines = input.lines.map(sendLine);
        if (lines.some((line) => line === null)) return { ok: false, error: failed };
        const sent = lines.filter((line): line is WorkLine => line !== null);
        const result = await inner.review?.({ ...input, lines: sent }, signal);
        return result === undefined
          ? { ok: false, error: failed }
          : restoreReview(result, work.originals);
      },
    }),
  };
}
