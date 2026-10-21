import type { Defect, ReviewKind, ReviewSample } from './content-form-sample.ts';

export interface ReviewComment {
  readonly line: number;
  readonly kind: ReviewKind | null;
  readonly text: string;
}

export interface Review {
  readonly comments: readonly ReviewComment[];
  readonly summary: string;
  readonly issues: readonly string[];
}

const ELEMENT =
  /<rs-comment\b([^>]*)>([\s\S]*?)<\/rs-comment>|<rs-summary\s*>([\s\S]*?)<\/rs-summary>/g;
const ATTRIBUTE = /([\w-]+)\s*=\s*"([^"]*)"/g;

export const MISSING_KIND = 'kind fehlt';

const collapse = (text: string) => text.replaceAll(/\s+/g, ' ').trim();

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function parseReview(output: string, lineCount: number): Review {
  const text = output
    .trim()
    .replace(/^```\w*\n?/, '')
    .replace(/\n?```$/, '');
  const comments: ReviewComment[] = [];
  const summaries: string[] = [];
  const issues: string[] = [];
  for (const match of text.matchAll(ELEMENT)) {
    const [, attributes, body, summary] = match;
    if (summary !== undefined) {
      summaries.push(collapse(summary));
      continue;
    }
    const values = new Map(
      [...(attributes ?? '').matchAll(ATTRIBUTE)].map(([, k = '', v = '']) => [k, v]),
    );
    const line = Number(values.get('n'));
    const kind = values.get('kind');
    const comment = collapse(body ?? '');
    const unknown = [...values.keys()].filter((key) => key !== 'n' && key !== 'kind');
    if (unknown.length > 0) issues.push(`unbekanntes Attribut ${unknown.join(', ')}`);
    if (!Number.isInteger(line) || line < 1 || line > lineCount)
      issues.push(`Zeile ${values.get('n') ?? '?'} ungültig`);
    else if (kind !== undefined && kind !== 'content' && kind !== 'form')
      issues.push(`kind ${kind} ungültig`);
    else if (comment === '' || /[<>]/.test(comment))
      issues.push(`Kommentar in Zeile ${line} leer oder mit Markup`);
    else {
      if (kind === undefined) issues.push(MISSING_KIND);
      comments.push({ line, kind: kind ?? null, text: comment });
    }
  }
  const rest = collapse(text.replaceAll(ELEMENT, ''));
  if (rest !== '') issues.push(`Text außerhalb der Elemente: ${rest.slice(0, 60)}`);
  if (summaries.length !== 1) issues.push(`${summaries.length} Schlusskommentare statt 1`);
  else if (summaries[0] === '') issues.push('Schlusskommentar leer');
  return { comments, summary: summaries[0] ?? '', issues };
}

const LINE_TOLERANCE = 2;

function mentions(text: string, keyword: string): boolean {
  const lower = text.toLowerCase();
  if (keyword.length >= 5) return lower.includes(keyword);
  return lower.split(/[^\p{L}\p{N}-]+/u).some((word) => word.startsWith(keyword));
}

export function matches(defect: Defect, text: string, line?: number): boolean {
  const near =
    line === undefined || defect.line === null || Math.abs(line - defect.line) <= LINE_TOLERANCE;
  return near && defect.keywords.some((keyword) => mentions(text, keyword));
}

export interface DefectScore {
  readonly label: string;
  readonly byComment: boolean;
  readonly bySummary: boolean;
  readonly kindAgrees: boolean;
}

export interface ReviewScore {
  readonly defects: readonly DefectScore[];
  readonly unmatched: readonly ReviewComment[];
  readonly longComments: number;
}

export function scoreReview(sample: ReviewSample, review: Review): ReviewScore {
  const defects = sample.defects.map((defect) => {
    const hits = review.comments.filter((comment) => matches(defect, comment.text, comment.line));
    return {
      label: defect.label,
      byComment: hits.length > 0,
      bySummary: matches(defect, review.summary),
      kindAgrees: hits.some((comment) => comment.kind === defect.kind),
    };
  });
  const unmatched = review.comments.filter(
    (comment) => !sample.defects.some((defect) => matches(defect, comment.text, comment.line)),
  );
  const longComments = review.comments.filter((comment) => wordCount(comment.text) > 6).length;
  return { defects, unmatched, longComments };
}

export function serializeReview(review: Pick<Review, 'comments' | 'summary'>): string {
  return [
    ...review.comments.map((comment) =>
      comment.kind === null
        ? `<rs-comment n="${comment.line}">${comment.text}</rs-comment>`
        : `<rs-comment n="${comment.line}" kind="${comment.kind}">${comment.text}</rs-comment>`,
    ),
    `<rs-summary>${review.summary}</rs-summary>`,
  ].join('\n');
}
