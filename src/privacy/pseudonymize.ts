import {
  PLACEHOLDER_LABELS,
  type IdentifierCategory,
  type PrivacySource,
  type PrivacySpan,
} from './types.ts';

export interface PrivacyPage {
  readonly lines: readonly string[];
  readonly spans: readonly PrivacySpan[];
}

export interface Replacement {
  readonly line: number;
  readonly offset: number;
  readonly length: number;
  readonly sentOffset: number;
  readonly placeholder: string;
  readonly original: string;
  readonly category: IdentifierCategory;
}

export interface PseudonymizedPage {
  readonly original: readonly string[];
  readonly lines: readonly string[];
  readonly replacements: readonly Replacement[];
}

export interface PseudonymizedWork {
  readonly pages: readonly PseudonymizedPage[];
  readonly originals: ReadonlyMap<string, string>;
}

interface Resolved {
  readonly start: number;
  readonly end: number;
  readonly category: IdentifierCategory;
  readonly source: PrivacySource;
}

const SOURCE_RANK: Readonly<Record<PrivacySource, number>> = {
  teacher: 3,
  model: 2,
  'name-list': 1,
  rule: 0,
};

function merge(spans: readonly Resolved[]): Resolved[] {
  const sorted = spans.toSorted((a, b) => a.start - b.start || b.end - a.end);
  const merged: Resolved[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last === undefined || span.start >= last.end) {
      merged.push(span);
      continue;
    }
    const lastLength = last.end - last.start;
    const spanLength = span.end - span.start;
    const lead =
      spanLength > lastLength ||
      (spanLength === lastLength && SOURCE_RANK[span.source] > SOURCE_RANK[last.source])
        ? span
        : last;
    merged[merged.length - 1] = {
      start: last.start,
      end: Math.max(last.end, span.end),
      category: lead.category,
      source: lead.source,
    };
  }
  return merged;
}

function clamp(text: string, span: PrivacySpan): Resolved | null {
  if (!Number.isFinite(span.offset) || !Number.isFinite(span.length)) return null;
  let start = Math.max(0, Math.trunc(span.offset));
  let end = Math.min(text.length, Math.trunc(span.offset + span.length));
  while (start < end && /\s/u.test(text.charAt(start))) start += 1;
  while (end > start && /\s/u.test(text.charAt(end - 1))) end -= 1;
  if (end <= start || span.kind !== 'identifier') return null;
  return { start, end, category: span.category, source: span.source };
}

export function resolveSpans(text: string, spans: readonly PrivacySpan[]): Resolved[] {
  const clamped = spans.flatMap((span) => clamp(text, span) ?? []);
  const teacher = merge(clamped.filter((span) => span.source === 'teacher'));
  const others = clamped.filter(
    (span) =>
      span.source !== 'teacher' &&
      !teacher.some((chosen) => span.start < chosen.end && chosen.start < span.end),
  );
  return merge([...teacher, ...merge(others)]);
}

const LABELS = Object.values(PLACEHOLDER_LABELS).join('|');
export const PLACEHOLDER = new RegExp(String.raw`\[(?:${LABELS}) \d+\]`, 'gu');

export function normalizeForm(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('de').replaceAll(/\s+/gu, ' ').trim();
}

export function pseudonymizeWork(pages: readonly PrivacyPage[]): PseudonymizedWork {
  const keys = new Map<string, string>();
  const originals = new Map<string, string>();
  const counters = new Map<IdentifierCategory, number>();
  const taken = new Set(pages.flatMap((page) => page.lines.join('\n').match(PLACEHOLDER) ?? []));

  const placeholderFor = (category: IdentifierCategory, original: string): string => {
    const key = `${category}\u0000${normalizeForm(original)}`;
    const known = keys.get(key);
    if (known !== undefined) return known;
    let next = counters.get(category) ?? 0;
    let placeholder = '';
    do {
      next += 1;
      placeholder = `[${PLACEHOLDER_LABELS[category]} ${next}]`;
    } while (taken.has(placeholder));
    counters.set(category, next);
    keys.set(key, placeholder);
    originals.set(placeholder, original);
    return placeholder;
  };

  const pseudonymized = pages.map((page): PseudonymizedPage => {
    const replacements: Replacement[] = [];
    const sent = page.lines.map((text, index) => {
      const line = index + 1;
      const spans = resolveSpans(
        text,
        page.spans.filter((span) => span.line === line),
      );
      let result = '';
      let cursor = 0;
      for (const span of spans) {
        result += text.slice(cursor, span.start);
        const original = text.slice(span.start, span.end);
        const placeholder = placeholderFor(span.category, original);
        replacements.push({
          line,
          offset: span.start,
          length: span.end - span.start,
          sentOffset: result.length,
          placeholder,
          original,
          category: span.category,
        });
        result += placeholder;
        cursor = span.end;
      }
      return result + text.slice(cursor);
    });
    return { original: page.lines, lines: sent, replacements };
  });
  return { pages: pseudonymized, originals };
}

export function pseudonymize(
  lines: readonly string[],
  spans: readonly PrivacySpan[],
): PseudonymizedPage & { readonly originals: ReadonlyMap<string, string> } {
  const work = pseudonymizeWork([{ lines, spans }]);
  const page = work.pages[0] ?? { original: lines, lines: [...lines], replacements: [] };
  return { ...page, originals: work.originals };
}
