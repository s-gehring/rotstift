import { editDistance } from '../correction/edit-distance.ts';
import { COMMON_WORDS } from './common-words.ts';
import type { PrivacyPage } from './pseudonymize.ts';
import { buildSearchText, toSpans, type SearchText } from './search-text.ts';
import type { IdentifierCategory, IdentifierSpan, PrivacySource, PrivacySpan } from './types.ts';

interface Form {
  readonly pattern: RegExp;
  readonly length: number;
  readonly category: IdentifierCategory;
  readonly source: PrivacySource;
  readonly capitalized: boolean;
}

interface FuzzyForm {
  readonly word: string;
  readonly category: IdentifierCategory;
  readonly source: PrivacySource;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const MIN_PART_LENGTH: Readonly<Partial<Record<IdentifierCategory, number>>> = {
  person: 2,
  place: 4,
  institution: 4,
};
const MIN_FUZZY_LENGTH = 5;

const GENERIC: ReadonlySet<string> = new Set(
  `schule gymnasium realschule gesamtschule grundschule oberschule hauptschule mittelschule stadtteilschule
  verein straße strasse str weg platz allee gasse kita kindergarten praxis klinik krankenhaus gemeinde
  kirchengemeinde pfarrei kirche sankt st dr frau herr herrn der die das dem den des am an im in auf zum zur
  und von bei mit`
    .split(/\s+/u)
    .filter(Boolean),
);

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
  return text.replaceAll(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
}

function formOf(
  text: string,
  category: IdentifierCategory,
  source: PrivacySource,
  capitalized = false,
): Form | null {
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
    capitalized,
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

const COMPOUND_CATEGORIES: ReadonlySet<IdentifierCategory> = new Set([
  'person',
  'place',
  'institution',
]);

function expandCompound(lines: readonly string[], span: PrivacySpan): PrivacySpan {
  if (span.kind !== 'identifier' || !COMPOUND_CATEGORIES.has(span.category)) return span;
  const text = lines[span.line - 1] ?? '';
  let start = span.offset;
  let end = span.offset + span.length;
  for (;;) {
    const joined = /\p{L}+-$/u.exec(text.slice(0, start));
    if (joined === null || !/^\p{L}/u.test(text.slice(start))) break;
    start = joined.index;
  }
  for (;;) {
    const joined = /^-\p{L}+/u.exec(text.slice(end));
    if (joined === null || !/\p{L}$/u.test(text.slice(0, end))) break;
    end += joined[0].length;
  }
  return start === span.offset && end === span.offset + span.length
    ? span
    : { ...span, offset: start, length: end - start };
}

function partsOf(text: string, category: IdentifierCategory): string[] {
  const minimum = MIN_PART_LENGTH[category];
  if (minimum === undefined) return [];
  const parts = text.match(/\p{L}+/gu) ?? [];
  if (category !== 'person' && (text.match(/[\p{L}\p{N}]+/gu) ?? []).length < 2) return [];
  return parts.filter((part) => {
    const lower = part.toLocaleLowerCase('de');
    if (part.length < minimum || GENERIC.has(lower)) return false;
    return category === 'person' || !COMMON_WORDS.has(lower);
  });
}

function formsOf(pages: readonly PrivacyPage[]): { forms: Form[]; fuzzy: FuzzyForm[] } {
  const forms: Form[] = [];
  const fuzzy: FuzzyForm[] = [];
  for (const page of pages) {
    const identifiers = page.spans.filter((span) => span.kind === 'identifier');
    for (const span of identifiers) {
      if (brokenAt(page.lines, span, identifiers)) continue;
      const text = spanText(page.lines, span);
      const full = formOf(
        text,
        span.category,
        span.source,
        COMMON_WORDS.has(text.trim().toLocaleLowerCase('de')),
      );
      if (full !== null) forms.push(full);
      for (const part of partsOf(text, span.category)) {
        const common = COMMON_WORDS.has(part.toLocaleLowerCase('de'));
        const form = formOf(part, span.category, span.source, common);
        if (form !== null) forms.push(form);
        if (!common && part.length >= MIN_FUZZY_LENGTH) {
          fuzzy.push({ word: fold(part), category: span.category, source: span.source });
        }
      }
    }
  }
  return { forms: forms.toSorted((a, b) => b.length - a.length), fuzzy };
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

function fuzzyLength(word: string, wanted: string): number {
  if (word.charAt(0) !== wanted.charAt(0)) return 0;
  if (Math.abs(word.length - wanted.length) <= 1 && editDistance(word, wanted) <= 1) {
    return word.length;
  }
  const stem = word.endsWith('s') ? word.slice(0, -1) : null;
  if (stem !== null && Math.abs(stem.length - wanted.length) <= 1) {
    if (editDistance(stem, wanted) <= 1) return stem.length;
  }
  return 0;
}

function addFuzzy(
  search: SearchText,
  folded: string,
  fuzzy: readonly FuzzyForm[],
  spans: PrivacySpan[],
) {
  if (fuzzy.length === 0) return;
  for (const match of folded.matchAll(/\p{L}+/gu)) {
    const word = match[0];
    if (word.length < MIN_FUZZY_LENGTH - 1) continue;
    const original = search.text.slice(match.index, match.index + word.length);
    if (COMMON_WORDS.has(original.toLocaleLowerCase('de'))) continue;
    for (const form of fuzzy) {
      const length = fuzzyLength(word, form.word);
      if (length === 0) continue;
      const found = toSpans(
        search,
        { start: match.index, end: match.index + length, category: form.category },
        form.source,
      );
      if (!found.some((span) => overlaps(span, spans))) spans.push(...found);
      break;
    }
  }
}

export function propagateSpans(pages: readonly PrivacyPage[]): PrivacySpan[][] {
  const expanded = pages.map((page) => ({
    ...page,
    spans: page.spans.map((span) => expandCompound(page.lines, span)),
  }));
  const { forms, fuzzy } = formsOf(expanded);
  return expanded.map((page) => {
    const spans: PrivacySpan[] = [...page.spans];
    if (forms.length === 0) return spans;
    const search = buildSearchText(page.lines);
    const folded = fold(search.text);
    for (const form of forms) {
      for (const match of folded.matchAll(form.pattern)) {
        if (form.capitalized && !/^\p{Lu}/u.test(search.text.charAt(match.index))) continue;
        const found = toSpans(
          search,
          { start: match.index, end: match.index + match[0].length, category: form.category },
          form.source,
        );
        if (found.some((span) => overlaps(span, spans))) continue;
        spans.push(...found);
      }
    }
    addFuzzy(search, folded, fuzzy, spans);
    return spans;
  });
}
