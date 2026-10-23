import type {
  GoldSpan,
  IdentifierCategory,
  PrivacySpan,
  SensitiveCategory,
} from './privacy-sample.ts';
import { isIdentifier, isSensitive } from './privacy-sample.ts';

const SIGNIFICANT = /[\p{L}\p{N}]/u;

export function coverage(lines: readonly string[], spans: readonly PrivacySpan[]): boolean[][] {
  const covered = lines.map((line) => Array.from({ length: line.length }, () => false));
  for (const span of spans) {
    const row = covered[span.line - 1];
    if (!row) continue;
    for (let at = span.offset; at < Math.min(row.length, span.offset + span.length); at++) {
      row[at] = true;
    }
  }
  return covered;
}

function charsOf(lines: readonly string[], spans: readonly GoldSpan[]) {
  return spans.flatMap((span) =>
    Array.from({ length: span.length }, (_, index) => ({
      line: span.line - 1,
      at: span.offset + index,
    })).filter(({ line, at }) => SIGNIFICANT.test(lines[line]?.[at] ?? '')),
  );
}

function byOccurrence(gold: readonly GoldSpan[]): GoldSpan[][] {
  const groups = new Map<number, GoldSpan[]>();
  for (const span of gold)
    groups.set(span.occurrence, [...(groups.get(span.occurrence) ?? []), span]);
  return [...groups.values()];
}

export interface WorkScore {
  identifiers: { category: IdentifierCategory; text: string; found: boolean }[];
  keep: { text: string; replaced: boolean }[];
  sensitive: { category: SensitiveCategory; text: string; found: boolean }[];
  sensitiveFalseAlarms: string[];
  words: number;
  overWords: string[];
}

function textOf(lines: readonly string[], spans: readonly GoldSpan[]): string {
  return spans
    .map((span) => lines[span.line - 1]?.slice(span.offset, span.offset + span.length))
    .join('⏎');
}

function overlaps(a: { line: number; offset: number; length: number }, b: typeof a): boolean {
  return a.line === b.line && a.offset < b.offset + b.length && b.offset < a.offset + a.length;
}

export function scoreWork(
  lines: readonly string[],
  gold: readonly GoldSpan[],
  predicted: readonly PrivacySpan[],
): WorkScore {
  const replaced = predicted.filter((span) => span.kind === 'identifier');
  const warned = predicted.filter((span) => span.kind === 'sensitive');
  const covered = coverage(lines, replaced);
  const isCovered = ({ line, at }: { line: number; at: number }) => covered[line]?.[at] === true;
  const groups = byOccurrence(gold);

  const identifiers = groups.flatMap((spans) => {
    const category = spans[0]?.category ?? 'keep';
    if (!isIdentifier(category)) return [];
    return [
      { category, text: textOf(lines, spans), found: charsOf(lines, spans).every(isCovered) },
    ];
  });
  const keep = groups
    .filter((spans) => spans[0]?.category === 'keep')
    .map((spans) => ({
      text: textOf(lines, spans),
      replaced: charsOf(lines, spans).some(isCovered),
    }));
  const sensitiveGold = groups.filter((spans) => isSensitive(spans[0]?.category ?? 'keep'));
  const sensitive = sensitiveGold.flatMap((spans) => {
    const category = spans[0]?.category ?? 'keep';
    if (!isSensitive(category)) return [];
    const found = spans.some((span) => warned.some((warning) => overlaps(span, warning)));
    return [{ category, text: textOf(lines, spans), found }];
  });
  const goldSensitive = sensitiveGold.flat();
  const sensitiveFalseAlarms = warned
    .filter((warning) => !goldSensitive.some((span) => overlaps(span, warning)))
    .map(
      (warning) =>
        lines[warning.line - 1]?.slice(warning.offset, warning.offset + warning.length) ?? '',
    );

  const goldIdentifier = coverage(
    lines,
    gold
      .filter((span) => isIdentifier(span.category))
      .map((span) => ({ ...span, kind: 'identifier', category: 'person', source: 'teacher' })),
  );
  let words = 0;
  const overWords: string[] = [];
  lines.forEach((line, row) => {
    for (const match of line.matchAll(/\S+/gu)) {
      const start = match.index;
      const indices = Array.from({ length: match[0].length }, (_, index) => start + index);
      const letters = indices.filter((at) => SIGNIFICANT.test(line[at] ?? ''));
      if (letters.length === 0) continue;
      words++;
      const hit = letters.some((at) => covered[row]?.[at]);
      const inGold = indices.some((at) => goldIdentifier[row]?.[at]);
      if (hit && !inGold) overWords.push(match[0]);
    }
  });
  return { identifiers, keep, sensitive, sensitiveFalseAlarms, words, overWords };
}

export function leaks(score: WorkScore): number {
  return score.identifiers.filter((occurrence) => !occurrence.found).length;
}

interface Step {
  from: number | null;
  to: number | null;
}

export function alignChars(a: string, b: string): (number | null)[] {
  const x = Array.from(a);
  const y = Array.from(b);
  const columns = y.length + 1;
  const cost = new Uint32Array((x.length + 1) * columns);
  for (let j = 0; j <= y.length; j++) cost[j] = j;
  for (let i = 1; i <= x.length; i++) {
    cost[i * columns] = i;
    for (let j = 1; j <= y.length; j++) {
      const change = (x[i - 1] ?? '').toLowerCase() === (y[j - 1] ?? '').toLowerCase() ? 0 : 1;
      cost[i * columns + j] = Math.min(
        (cost[(i - 1) * columns + j - 1] ?? 0) + change,
        (cost[(i - 1) * columns + j] ?? 0) + 1,
        (cost[i * columns + j - 1] ?? 0) + 1,
      );
    }
  }
  const steps: Step[] = [];
  let i = x.length;
  let j = y.length;
  while (i > 0 || j > 0) {
    const here = cost[i * columns + j] ?? 0;
    const change = (x[i - 1] ?? '').toLowerCase() === (y[j - 1] ?? '').toLowerCase() ? 0 : 1;
    if (i > 0 && j > 0 && here === (cost[(i - 1) * columns + j - 1] ?? 0) + change) {
      steps.push({ from: i - 1, to: j - 1 });
      i--;
      j--;
    } else if (i > 0 && here === (cost[(i - 1) * columns + j] ?? 0) + 1) {
      steps.push({ from: i - 1, to: null });
      i--;
    } else {
      j--;
    }
  }
  const map: (number | null)[] = Array.from({ length: x.length }, () => null);
  for (const step of steps) if (step.from !== null) map[step.from] = step.to;
  return map;
}

function flatIndex(lines: readonly string[]) {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return starts;
}

export function transferGold(
  source: readonly string[],
  gold: readonly GoldSpan[],
  target: readonly string[],
): GoldSpan[] {
  const map = alignChars(source.join('\n'), target.join('\n'));
  const sourceStarts = flatIndex(source);
  const targetStarts = flatIndex(target);
  const locate = (flat: number) => {
    let line = 0;
    while (line + 1 < targetStarts.length && (targetStarts[line + 1] ?? 0) <= flat) line++;
    return { line, offset: flat - (targetStarts[line] ?? 0) };
  };
  return byOccurrence(gold).flatMap((spans) => {
    const mapped = spans.flatMap((span) =>
      Array.from(
        { length: span.length },
        (_, index) => map[(sourceStarts[span.line - 1] ?? 0) + span.offset + index],
      ),
    );
    const hits = mapped.filter((value): value is number => value !== null && value !== undefined);
    if (hits.length === 0) return [];
    const first = Math.min(...hits);
    const last = Math.max(...hits);
    const start = locate(first);
    const end = locate(last);
    const result: GoldSpan[] = [];
    for (let line = start.line; line <= end.line; line++) {
      const offset = line === start.line ? start.offset : 0;
      const stop = line === end.line ? end.offset + 1 : (target[line] ?? '').length;
      if (stop > offset) {
        result.push({
          line: line + 1,
          offset,
          length: stop - offset,
          category: spans[0]?.category ?? 'keep',
          occurrence: spans[0]?.occurrence ?? 0,
        });
      }
    }
    return result;
  });
}
