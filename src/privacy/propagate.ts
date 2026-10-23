import { COMMON_WORDS } from './common-words.ts';
import type { PrivacyPage } from './pseudonymize.ts';
import { buildSearchText, toSpans } from './search-text.ts';
import type { IdentifierCategory, IdentifierSpan, PrivacySource, PrivacySpan } from './types.ts';

interface Form {
  readonly pattern: RegExp;
  readonly length: number;
  readonly category: IdentifierCategory;
  readonly source: PrivacySource;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const MIN_PART_LENGTH = 3;

function foldChar(char: string): string {
  const plain = char.normalize('NFD').replaceAll(/\p{M}/gu, '').toLocaleLowerCase('de');
  if (plain.length === 1) return plain;
  const lower = char.toLocaleLowerCase('de');
  return lower.length === 1 ? lower : char;
}

function fold(text: string): string {
  return Array.from(text, (char) => (char.length === 1 ? foldChar(char) : char)).join('');
}

function escape(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\/-]/gu, '\\$&');
}

function formOf(text: string, category: IdentifierCategory, source: PrivacySource): Form | null {
  const folded = fold(text.trim()).replaceAll(/\s+/gu, ' ');
  if (folded === '') return null;
  const body = folded
    .split(' ')
    .map(escape)
    .join(String.raw`\s+`);
  const before = WORD_CHAR.test(folded.charAt(0)) ? String.raw`(?<![\p{L}\p{N}])` : '';
  const after = /\p{L}$/u.test(folded)
    ? String.raw`(?=s?(?![\p{L}\p{N}]))`
    : WORD_CHAR.test(folded.charAt(folded.length - 1))
      ? String.raw`(?![\p{L}\p{N}])`
      : '';
  return {
    pattern: new RegExp(`${before}${body}${after}`, 'gu'),
    length: folded.length,
    category,
    source,
  };
}

function spanText(lines: readonly string[], span: IdentifierSpan): string {
  return (lines[span.line - 1] ?? '').slice(
    Math.max(0, span.offset),
    Math.max(0, span.offset + span.length),
  );
}

function brokenAt(
  lines: readonly string[],
  span: IdentifierSpan,
  spans: readonly IdentifierSpan[],
) {
  const text = spanText(lines, span).trim();
  if (
    text.endsWith('-') &&
    span.offset + span.length >= (lines[span.line - 1] ?? '').trimEnd().length
  )
    return true;
  return (
    span.offset === 0 &&
    spans.some(
      (other) => other.line === span.line - 1 && spanText(lines, other).trim().endsWith('-'),
    )
  );
}

function formsOf(pages: readonly PrivacyPage[]): Form[] {
  const forms: Form[] = [];
  for (const page of pages) {
    const identifiers = page.spans.filter((span) => span.kind === 'identifier');
    for (const span of identifiers) {
      if (brokenAt(page.lines, span, identifiers)) continue;
      const text = spanText(page.lines, span);
      const full = formOf(text, span.category, span.source);
      if (full !== null) forms.push(full);
      if (span.category !== 'person') continue;
      for (const part of text.match(/\p{L}+/gu) ?? []) {
        if (part.length < MIN_PART_LENGTH || COMMON_WORDS.has(part.toLocaleLowerCase('de'))) {
          continue;
        }
        const form = formOf(part, 'person', span.source);
        if (form !== null) forms.push(form);
      }
    }
  }
  return forms.toSorted((a, b) => b.length - a.length);
}

function overlaps(span: PrivacySpan, others: readonly PrivacySpan[]): boolean {
  return others.some(
    (other) =>
      other.kind === 'identifier' &&
      other.line === span.line &&
      span.offset < other.offset + other.length &&
      other.offset < span.offset + span.length,
  );
}

export function propagateSpans(pages: readonly PrivacyPage[]): PrivacySpan[][] {
  const forms = formsOf(pages);
  return pages.map((page) => {
    const spans: PrivacySpan[] = [...page.spans];
    if (forms.length === 0) return spans;
    const search = buildSearchText(page.lines);
    const folded = fold(search.text);
    for (const form of forms) {
      for (const match of folded.matchAll(form.pattern)) {
        const found = toSpans(
          search,
          { start: match.index, end: match.index + match[0].length, category: form.category },
          form.source,
        );
        if (found.some((span) => overlaps(span, spans))) continue;
        spans.push(...found);
      }
    }
    return spans;
  });
}
