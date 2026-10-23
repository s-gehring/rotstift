import { continuesHyphenation } from '../stats/statistics.ts';
import type { IdentifierCategory, IdentifierSpan, PrivacySource } from './types.ts';

export interface SearchText {
  readonly text: string;
  readonly lines: readonly string[];
  readonly lineOf: Int32Array;
  readonly offsetOf: Int32Array;
}

export interface Range {
  readonly start: number;
  readonly end: number;
}

export interface CategorizedRange extends Range {
  readonly category: IdentifierCategory;
}

export function buildSearchText(lines: readonly string[]): SearchText {
  const chars: string[] = [];
  const lineOf: number[] = [];
  const offsetOf: number[] = [];
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    if (previous !== undefined && continuesHyphenation(previous, line)) {
      chars.pop();
      lineOf.pop();
      offsetOf.pop();
    } else if (index > 0) {
      chars.push('\n');
      lineOf.push(-1);
      offsetOf.push(-1);
    }
    for (let offset = 0; offset < line.length; offset += 1) {
      chars.push(line.charAt(offset));
      lineOf.push(index);
      offsetOf.push(offset);
    }
  });
  return {
    text: chars.join(''),
    lines,
    lineOf: Int32Array.from(lineOf),
    offsetOf: Int32Array.from(offsetOf),
  };
}

export function toSpans(
  search: SearchText,
  range: CategorizedRange,
  source: PrivacySource,
): IdentifierSpan[] {
  const parts = new Map<number, { start: number; end: number }>();
  for (let index = range.start; index < range.end; index += 1) {
    const line = search.lineOf[index] ?? -1;
    if (line < 0) continue;
    const offset = search.offsetOf[index] ?? 0;
    const part = parts.get(line);
    if (part === undefined) parts.set(line, { start: offset, end: offset + 1 });
    else part.end = offset + 1;
  }
  const lines = [...parts.keys()].toSorted((a, b) => a - b);
  return lines.map((line, index) => {
    const part = parts.get(line) ?? { start: 0, end: 0 };
    const text = search.lines[line] ?? '';
    const brokenHyphen = index < lines.length - 1 && text.slice(part.end) === '-';
    return {
      kind: 'identifier',
      category: range.category,
      source,
      line: line + 1,
      offset: part.start,
      length: part.end - part.start + (brokenHyphen ? 1 : 0),
    };
  });
}

export function mergeRanges(ranges: readonly CategorizedRange[]): CategorizedRange[] {
  const sorted = ranges.toSorted((a, b) => a.start - b.start || b.end - a.end);
  const merged: CategorizedRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last === undefined || range.start >= last.end) {
      merged.push(range);
      continue;
    }
    const longer = range.end - range.start > last.end - last.start ? range : last;
    merged[merged.length - 1] = {
      start: last.start,
      end: Math.max(last.end, range.end),
      category: longer.category,
    };
  }
  return merged;
}
