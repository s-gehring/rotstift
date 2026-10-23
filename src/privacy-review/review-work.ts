import { editDistance } from '../correction/edit-distance.ts';
import { propagateSpans } from '../privacy/propagate.ts';
import { normalizeForm, pseudonymizeWork } from '../privacy/pseudonymize.ts';
import type { PrivacyWorkPage } from '../privacy/pseudonymizing-corrector.ts';
import type {
  IdentifierCategory,
  IdentifierSpan,
  PrivacySpan,
  SensitiveCategory,
} from '../privacy/types.ts';

export type PrivacyWorkStatus = 'detecting' | 'open' | 'released' | 'failed';

export interface PrivacyWork {
  readonly id: string;
  readonly name: string;
  readonly status: PrivacyWorkStatus;
  readonly pages: readonly PrivacyWorkPage[];
  readonly removed: readonly string[];
  readonly message: string | null;
}

export interface TextRange {
  readonly line: number;
  readonly offset: number;
  readonly length: number;
}

export type Segment =
  | { readonly kind: 'plain'; readonly text: string }
  | {
      readonly kind: 'identifier';
      readonly text: string;
      readonly placeholder: string;
      readonly category: IdentifierCategory;
      readonly range: TextRange;
    }
  | { readonly kind: 'sensitive'; readonly text: string; readonly category: SensitiveCategory };

export interface ReviewLine {
  readonly line: number;
  readonly segments: readonly Segment[];
}

export interface ReviewPageText {
  readonly pageId: string;
  readonly lines: readonly ReviewLine[];
}

export const SENSITIVE_LABELS: Readonly<Record<SensitiveCategory, string>> = {
  health: 'Gesundheit',
  origin: 'Herkunft',
  religion: 'Religion',
  politics: 'Politische Meinung',
  sexuality: 'Sexualleben',
  union: 'Gewerkschaft',
  circumstances: 'Private Lebensumstände',
};

function textAt(lines: readonly string[], range: TextRange): string {
  return (lines[range.line - 1] ?? '').slice(range.offset, range.offset + range.length);
}

function overlaps(a: TextRange, b: TextRange): boolean {
  return a.line === b.line && a.offset < b.offset + b.length && b.offset < a.offset + a.length;
}

function keyOf(page: PrivacyWorkPage, span: PrivacySpan): string {
  return normalizeForm(textAt(page.lines, span));
}

const MIN_FUZZY_WORD = 5;

function wordsOf(key: string): string[] {
  return key.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function sameWord(word: string, wanted: string): boolean {
  if (word === wanted) return true;
  return (
    wanted.length >= MIN_FUZZY_WORD &&
    word.charAt(0) === wanted.charAt(0) &&
    Math.abs(word.length - wanted.length) <= 1 &&
    editDistance(word, wanted) <= 1
  );
}

export function inGroup(key: string, chosen: string): boolean {
  const own = wordsOf(chosen);
  const words = wordsOf(key);
  return words.length > 0 && words.every((word) => own.some((wanted) => sameWord(word, wanted)));
}

function identifierKeys(pages: readonly PrivacyWorkPage[]): string[] {
  return [
    ...new Set(
      pages.flatMap((page) =>
        page.spans.filter((span) => span.kind === 'identifier').map((span) => keyOf(page, span)),
      ),
    ),
  ];
}

function withoutRemoved(
  pages: readonly PrivacyWorkPage[],
  removed: readonly string[],
): PrivacyWorkPage[] {
  const keys = new Set(removed);
  return pages.map((page) => ({
    ...page,
    spans: page.spans.filter((span) => span.kind !== 'identifier' || !keys.has(keyOf(page, span))),
  }));
}

function trimmed(lines: readonly string[], range: TextRange): TextRange | null {
  const text = lines[range.line - 1];
  if (text === undefined) return null;
  let start = Math.max(0, range.offset);
  let end = Math.min(text.length, range.offset + range.length);
  while (start < end && /\s/u.test(text.charAt(start))) start += 1;
  while (end > start && /\s/u.test(text.charAt(end - 1))) end -= 1;
  return end > start ? { line: range.line, offset: start, length: end - start } : null;
}

export function addIdentifier(
  work: PrivacyWork,
  pageId: string,
  range: TextRange,
  category: IdentifierCategory,
): PrivacyWork {
  const page = work.pages.find((candidate) => candidate.pageId === pageId);
  if (work.status !== 'open' || page === undefined) return work;
  const chosen = trimmed(page.lines, range);
  if (chosen === null) return work;
  const key = normalizeForm(textAt(page.lines, chosen));
  const removed = work.removed.filter((entry) => !inGroup(entry, key));
  const added: IdentifierSpan = { kind: 'identifier', category, source: 'teacher', ...chosen };
  const pages = work.pages.map((candidate) =>
    candidate.pageId === pageId
      ? {
          ...candidate,
          spans: [...candidate.spans.filter((span) => !overlaps(span, chosen)), added],
        }
      : candidate,
  );
  const propagated = propagateSpans(pages);
  return {
    ...work,
    removed,
    pages: withoutRemoved(
      pages.map((candidate, index) => ({
        ...candidate,
        spans: propagated[index] ?? candidate.spans,
      })),
      removed,
    ),
  };
}

export function removeIdentifier(work: PrivacyWork, pageId: string, range: TextRange): PrivacyWork {
  const page = work.pages.find((candidate) => candidate.pageId === pageId);
  if (work.status !== 'open' || page === undefined) return work;
  const chosen = page.spans
    .filter((span) => span.kind === 'identifier' && overlaps(span, range))
    .map((span) => keyOf(page, span));
  if (chosen.length === 0) return work;
  const keys = identifierKeys(work.pages).filter((key) =>
    chosen.some((entry) => inGroup(key, entry)),
  );
  const removed = [...new Set([...work.removed, ...keys])];
  return { ...work, removed, pages: withoutRemoved(work.pages, removed) };
}

export function dropPages(work: PrivacyWork, present: ReadonlySet<string>): PrivacyWork {
  const pages = work.pages.filter((page) => present.has(page.pageId));
  return pages.length === work.pages.length ? work : { ...work, pages };
}

interface Marked {
  readonly start: number;
  readonly end: number;
  readonly segment: Exclude<Segment, { kind: 'plain' }>;
}

function lineSegments(text: string, marked: readonly Marked[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const mark of marked.toSorted((a, b) => a.start - b.start)) {
    if (mark.start < cursor) continue;
    if (mark.start > cursor) segments.push({ kind: 'plain', text: text.slice(cursor, mark.start) });
    segments.push(mark.segment);
    cursor = mark.end;
  }
  if (cursor < text.length || segments.length === 0) {
    segments.push({ kind: 'plain', text: text.slice(cursor) });
  }
  return segments;
}

export function reviewText(work: Pick<PrivacyWork, 'pages'>): ReviewPageText[] {
  const pseudonymized = pseudonymizeWork(work.pages);
  return work.pages.map((page, index) => {
    const replacements = pseudonymized.pages[index]?.replacements ?? [];
    return {
      pageId: page.pageId,
      lines: page.lines.map((text, lineIndex) => {
        const line = lineIndex + 1;
        const identifiers: Marked[] = replacements
          .filter((replacement) => replacement.line === line)
          .map((replacement) => ({
            start: replacement.offset,
            end: replacement.offset + replacement.length,
            segment: {
              kind: 'identifier',
              text: replacement.original,
              placeholder: replacement.placeholder,
              category: replacement.category,
              range: { line, offset: replacement.offset, length: replacement.length },
            },
          }));
        const sensitive: Marked[] = page.spans
          .filter((span) => span.kind === 'sensitive' && span.line === line)
          .map((span) => ({ start: span.offset, end: span.offset + span.length, span }))
          .filter(
            ({ start, end }) =>
              end > start && !identifiers.some((mark) => start < mark.end && mark.start < end),
          )
          .flatMap(({ start, end, span }) =>
            span.kind === 'sensitive'
              ? [
                  {
                    start,
                    end,
                    segment: {
                      kind: 'sensitive' as const,
                      text: text.slice(start, end),
                      category: span.category,
                    },
                  },
                ]
              : [],
          );
        return { line, segments: lineSegments(text, [...identifiers, ...sensitive]) };
      }),
    };
  });
}
