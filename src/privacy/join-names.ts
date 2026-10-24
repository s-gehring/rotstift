import { COMMON_WORDS } from './common-words.ts';
import { buildSearchText, toSpans, type CategorizedRange, type SearchText } from './search-text.ts';
import type { PrivacySpan } from './types.ts';
import { WORD_SURNAMES } from './word-surnames.ts';

const PARTICLES: ReadonlySet<string> = new Set(['von', 'van', 'vom', 'de', 'zu', 'der', 'ter']);

function personRanges(search: SearchText, spans: readonly PrivacySpan[]): [number, number][] {
  const index = new Map<string, number>();
  for (let at = 0; at < search.text.length; at += 1) {
    index.set(`${search.lineOf[at]}:${search.offsetOf[at]}`, at);
  }
  return spans.flatMap((span): [number, number][] => {
    if (span.kind !== 'identifier' || span.category !== 'person' || span.length === 0) return [];
    const start = index.get(`${span.line - 1}:${span.offset}`) ?? -1;
    const last = index.get(`${span.line - 1}:${span.offset + span.length - 1}`) ?? -1;
    return start < 0 || last < 0 ? [] : [[start, last + 1]];
  });
}

function covered(ranges: readonly [number, number][], at: number): boolean {
  return ranges.some(([start, end]) => at >= start && at < end);
}

export function joinNames(lines: readonly string[], spans: readonly PrivacySpan[]): PrivacySpan[] {
  const search = buildSearchText(lines);
  const ranges = personRanges(search, spans);
  const added: CategorizedRange[] = [];
  for (const [start, end] of ranges) {
    const after = /^(?:['’]?s)?\s+(\p{Lu}\p{Ll}+)(?![\p{L}\p{N}])/u.exec(search.text.slice(end));
    if (after !== null && WORD_SURNAMES.has((after[1] ?? '').toLocaleLowerCase('de'))) {
      const from = end + after[0].length - (after[1] ?? '').length;
      added.push({ start: from, end: end + after[0].length, category: 'person' });
    }
    const gap = /^[ \t]+(\p{Ll}{1,4})[ \t]+/u.exec(search.text.slice(end));
    if (gap !== null && covered(ranges, end + gap[0].length)) {
      const word = gap[1] ?? '';
      if (PARTICLES.has(word) || !COMMON_WORDS.has(word)) {
        added.push({ start: end, end: end + gap[0].length, category: 'person' });
      }
    }
    const before = /(?<![\p{L}\p{N}])(\p{Lu}\p{L}{0,2})\s+$/u.exec(search.text.slice(0, start));
    if (before !== null && !COMMON_WORDS.has((before[1] ?? '').toLocaleLowerCase('de'))) {
      added.push({ start: before.index, end: start, category: 'person' });
    }
  }
  return [...spans, ...added.flatMap((range) => toSpans(search, range, 'rule'))];
}

const DETERMINERS =
  'der|die|das|den|dem|des|ein|eine|einen|einem|eines|einer|kein|keine|keinen|keinem|jeder|jede|jedes|dieser|diese|dieses|diesem|diesen|zum|zur|vom|im|am|beim|ins';

const DETERMINER = new RegExp(
  String.raw`(?<![\p{L}])(?:${DETERMINERS.split('|')
    .map((word) => `[${word.charAt(0)}${word.charAt(0).toUpperCase()}]${word.slice(1)}`)
    .join('|')})\s+(?:\p{Ll}+(?:e|er|en|em|es)\s+){0,2}$`,
  'u',
);

export function withoutNounUses(
  lines: readonly string[],
  spans: readonly PrivacySpan[],
): PrivacySpan[] {
  return spans.filter((span) => {
    if (span.kind !== 'identifier' || span.category !== 'person') return true;
    const line = lines[span.line - 1] ?? '';
    const word = line.slice(span.offset, span.offset + span.length).toLocaleLowerCase('de');
    if (!COMMON_WORDS.has(word) && !WORD_SURNAMES.has(word)) return true;
    return !DETERMINER.test(line.slice(0, span.offset));
  });
}
