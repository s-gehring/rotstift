import { at } from './at.ts';
import type { CorrectionProfile } from '../annotations/profile.ts';
import type { Mark, TranscriptLine } from '../annotations/transcript.ts';
import { align } from './align.ts';
import type { Op } from './align.ts';
import { classifyWordChange } from './classify.ts';
import { codeFor } from './kinds.ts';
import type { MarkRole } from './kinds.ts';
import { joinCorrected, tokenizeCorrected, tokenizeLines } from './tokens.ts';
import type { CorrectedToken, OriginalToken, Span } from './tokens.ts';

export const DEFAULT_MAX_CHANGED_RUN = 3;

const BRIDGE_WORDS = 1;
const COLLAPSE_DENSITY = 0.6;
const MAX_MOVE_WORDS = 4;

export interface DeriveOptions {
  profile: CorrectionProfile;
  maxChangedRun?: number;
}

interface Range {
  start: number;
  end: number;
}

interface Anchor {
  line: number;
  offset: number;
}

function originalOf(op: Op): OriginalToken | null {
  return op.type === 'ins' ? null : op.o;
}

function correctedOf(op: Op): CorrectedToken | null {
  return op.type === 'del' ? null : op.c;
}

function firstLine(token: OriginalToken): number {
  return at(token.parts, 0).line;
}

function countWords(ops: readonly Op[]) {
  let original = 0;
  let corrected = 0;
  for (const op of ops) {
    if (originalOf(op)?.kind === 'word') original += 1;
    if (correctedOf(op)?.kind === 'word') corrected += 1;
  }
  return { original, corrected };
}

function changedWords(ops: readonly Op[]): number {
  const { original, corrected } = countWords(ops.filter((op) => op.type !== 'match'));
  return Math.max(original, corrected);
}

function onlyWords(tokens: readonly { kind: string }[]) {
  return tokens.filter((token) => token.kind === 'word');
}

function squash(tokens: readonly { text: string }[]): string {
  return tokens
    .map((token) => token.text)
    .join('')
    .toLowerCase();
}

function wordsOf(ops: readonly Op[], side: 'o' | 'c'): string[] {
  return ops.flatMap((op) => {
    const token = side === 'o' ? originalOf(op) : correctedOf(op);
    return token?.kind === 'word' ? [token.text.toLowerCase()] : [];
  });
}

function countWordsBy(words: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

function isReordering(ops: readonly Op[]): boolean {
  const before = wordsOf(ops, 'o');
  const after = wordsOf(ops, 'c');
  if (before.length < 2 || before.join(' ') === after.join(' ')) return false;
  const counts = countWordsBy(before);
  const other = countWordsBy(after);
  return counts.size === other.size && [...counts].every(([word, n]) => other.get(word) === n);
}

function sharesLine(ops: readonly Op[]): boolean {
  const lines = new Set(ops.flatMap((op) => originalOf(op) ?? []).map(firstLine));
  return lines.size <= 1;
}

function findMoves(ops: readonly Op[], hunks: readonly Range[]) {
  const moves: { range: Range; first: number; last: number }[] = [];
  let first = 0;
  while (first < hunks.length) {
    let found = false;
    for (let last = first; last < hunks.length; last += 1) {
      const start = at(hunks, first).start;
      const end = at(hunks, last).end;
      if (last > first) {
        const gap = ops.slice(at(hunks, last - 1).end, at(hunks, last).start);
        if (wordsOf(gap, 'o').length > MAX_MOVE_WORDS) break;
      }
      const region = ops.slice(start, end);
      if (isReordering(region) && sharesLine(region)) {
        moves.push({ range: { start, end }, first, last });
        first = last + 1;
        found = true;
        break;
      }
    }
    if (!found) first += 1;
  }
  return moves;
}

interface Segment {
  span: Span;
  weight: number;
}

function segmentsOf(tokens: readonly OriginalToken[]): Segment[] {
  const segments: Segment[] = [];
  for (const token of tokens) {
    for (const part of token.parts) {
      const weight = 1 / token.parts.length;
      const last = segments.at(-1);
      if (last?.span.line === part.line) {
        last.span = { ...last.span, end: Math.max(last.span.end, part.end) };
        last.weight += weight;
      } else {
        segments.push({ span: part, weight });
      }
    }
  }
  return segments;
}

export interface DerivedMarks {
  lines: TranscriptLine[];
  droppedOverlaps: number;
}

export function deriveMarks(
  lines: readonly string[],
  correctedText: string,
  options: DeriveOptions,
): TranscriptLine[] {
  return deriveMarksDetailed(lines, correctedText, options).lines;
}

export function deriveMarksDetailed(
  lines: readonly string[],
  correctedText: string,
  options: DeriveOptions,
): DerivedMarks {
  const { profile } = options;
  const maxChangedRun = options.maxChangedRun ?? DEFAULT_MAX_CHANGED_RUN;
  const joined = joinCorrected(correctedText);
  const original = tokenizeLines(lines).flat();
  const ops = align(original, tokenizeCorrected(joined));
  const marksByLine: Mark[][] = lines.map(() => []);

  function sliceCorrected(tokens: readonly CorrectedToken[]): string {
    const first = tokens[0];
    const last = tokens.at(-1);
    return first === undefined || last === undefined ? '' : joined.slice(first.start, last.end);
  }

  function addError(tokens: readonly OriginalToken[], correction: string, role: MarkRole) {
    const type = codeFor(profile, role);
    if (type === null || tokens.length === 0) return;
    const segments = segmentsOf(tokens);
    const words = correction === '' ? [] : correction.split(' ');
    const total = segments.reduce((sum, segment) => sum + segment.weight, 0);
    let given = 0;
    let seen = 0;
    segments.forEach((segment, index) => {
      seen += segment.weight;
      const upto =
        index === segments.length - 1 ? words.length : Math.round((words.length * seen) / total);
      addErrorAt(segment.span, words.slice(given, upto).join(' '), type);
      given = upto;
    });
  }

  function addErrorAt(span: Span, correction: string, type: string) {
    const text = at(lines, span.line);
    const originalText = text.slice(span.start, span.end);
    if (originalText === '' || originalText === correction) return;
    at(marksByLine, span.line).push({
      kind: 'error',
      type,
      original: originalText,
      correction,
      offset: span.start,
    });
  }

  function addDeletion(tokens: readonly OriginalToken[]) {
    const role: MarkRole = tokens.every((token) => token.kind === 'punct')
      ? 'punctuation'
      : 'wording';
    addError(tokens, '', role);
  }

  function anchorFor(start: number, end: number, punctuationOnly: boolean): Anchor {
    let previous: OriginalToken | null = null;
    for (let index = start - 1; index >= 0 && previous === null; index -= 1) {
      previous = originalOf(at(ops, index));
    }
    let next: OriginalToken | null = null;
    for (let index = end; index < ops.length && next === null; index += 1) {
      next = originalOf(at(ops, index));
    }
    const previousEnd = previous?.parts.at(-1);
    const nextStart = next?.parts[0];
    if (punctuationOnly && previousEnd) return { line: previousEnd.line, offset: previousEnd.end };
    if (nextStart && (!previousEnd || previousEnd.line === nextStart.line)) {
      return { line: nextStart.line, offset: nextStart.start };
    }
    if (previousEnd) return { line: previousEnd.line, offset: previousEnd.end };
    return { line: 0, offset: 0 };
  }

  function addOmission(range: Range, tokens: readonly CorrectedToken[]) {
    const punctuationOnly = tokens.every((token) => token.kind === 'punct');
    const type = codeFor(profile, punctuationOnly ? 'punctuation' : 'wording');
    const correction = sliceCorrected(tokens);
    if (type === null || correction === '' || lines.length === 0) return;
    const anchor = anchorFor(range.start, range.end, punctuationOnly);
    at(marksByLine, anchor.line).push({
      kind: 'omission',
      type,
      original: '',
      correction,
      offset: anchor.offset,
    });
  }

  function addHyphenated(token: OriginalToken, corrected: string, role: MarkRole) {
    const type = codeFor(profile, role);
    const head = at(token.parts, 0);
    const tail = at(token.parts, 1);
    if (type === null) return;
    const headText = at(lines, head.line).slice(head.start, head.end);
    const tailText = at(lines, tail.line).slice(tail.start, tail.end);
    if (corrected.startsWith(headText)) {
      addErrorAt(tail, corrected.slice(headText.length), type);
    } else if (corrected.endsWith(tailText)) {
      addErrorAt(head, corrected.slice(0, corrected.length - tailText.length), type);
    } else {
      addErrorAt(head, corrected, type);
    }
  }

  function emitSubstitution(o: OriginalToken, c: CorrectedToken) {
    if (o.kind === 'punct') {
      addError([o], c.text, 'punctuation');
      return;
    }
    const role = classifyWordChange(o.text, c.text, profile.language);
    if (o.parts.length > 1) addHyphenated(o, c.text, role);
    else addError([o], c.text, role);
  }

  function emitRange(range: Range) {
    let index = range.start;
    while (index < range.end) {
      const op = at(ops, index);
      let next = index + 1;
      if (op.type === 'sub') {
        emitSubstitution(op.o, op.c);
      } else if (op.type === 'del') {
        while (next < range.end && at(ops, next).type === 'del') next += 1;
        addDeletion(ops.slice(index, next).flatMap((item) => originalOf(item) ?? []));
      } else if (op.type === 'ins') {
        while (next < range.end && at(ops, next).type === 'ins') next += 1;
        addOmission(
          { start: index, end: next },
          ops.slice(index, next).flatMap((item) => correctedOf(item) ?? []),
        );
      }
      index = next;
    }
  }

  function emitCollapsed(range: Range) {
    const slice = ops.slice(range.start, range.end);
    const originals = slice.flatMap((op) => originalOf(op) ?? []);
    const corrected = slice.flatMap((op) => correctedOf(op) ?? []);
    if (originals.length > 0) addError(originals, sliceCorrected(corrected), 'wording');
    else addOmission(range, corrected);
  }

  function emitMove(range: Range) {
    const slice = ops.slice(range.start, range.end);
    addError(
      slice.flatMap((op) => originalOf(op) ?? []),
      sliceCorrected(slice.flatMap((op) => correctedOf(op) ?? [])),
      'wordOrder',
    );
  }

  function emitJoinedOrSplit(range: Range): boolean {
    const slice = ops.slice(range.start, range.end);
    const originals = slice.flatMap((op) => originalOf(op) ?? []);
    const corrected = slice.flatMap((op) => correctedOf(op) ?? []);
    if (originals.length !== onlyWords(originals).length) return false;
    if (corrected.length !== onlyWords(corrected).length) return false;
    if (originals.length === 0 || corrected.length === 0 || originals.length === corrected.length) {
      return false;
    }
    if (squash(originals) !== squash(corrected)) return false;
    addError(originals, sliceCorrected(corrected), 'spelling');
    return true;
  }

  const hunks: Range[] = [];
  let index = 0;
  while (index < ops.length) {
    if (at(ops, index).type === 'match') {
      index += 1;
      continue;
    }
    const start = index;
    while (index < ops.length && at(ops, index).type !== 'match') index += 1;
    hunks.push({ start, end: index });
  }

  const moves = findMoves(ops, hunks);
  const moved = new Set(moves.flatMap(({ first, last }) => hunks.slice(first, last + 1)));
  for (const move of moves) emitMove(move.range);

  const pending = hunks.filter((hunk) => !moved.has(hunk) && !emitJoinedOrSplit(hunk));
  let cursor = 0;
  while (cursor < pending.length) {
    let last = cursor;
    while (last + 1 < pending.length) {
      const gap = ops.slice(at(pending, last).end, at(pending, last + 1).start);
      const bridged = gap.every((op) => op.type === 'match');
      const gapWords = gap.filter((op) => originalOf(op)?.kind === 'word').length;
      if (!bridged || gapWords > BRIDGE_WORDS) break;
      last += 1;
    }
    const first = at(pending, cursor);
    const cluster = { start: first.start, end: at(pending, last).end };
    const span = ops.slice(cluster.start, cluster.end);
    const spanWords = Math.max(countWords(span).original, countWords(span).corrected);
    const changed = changedWords(span);
    if (changed > maxChangedRun && changed / spanWords >= COLLAPSE_DENSITY) {
      emitCollapsed(cluster);
    } else {
      for (const hunk of pending.slice(cursor, last + 1)) {
        if (changedWords(ops.slice(hunk.start, hunk.end)) > maxChangedRun) emitCollapsed(hunk);
        else emitRange(hunk);
      }
    }
    cursor = last + 1;
  }

  let droppedOverlaps = 0;
  const derived = lines.map((text, line) => {
    const all = at(marksByLine, line);
    const marks = withoutOverlaps(all);
    droppedOverlaps += all.length - marks.length;
    return { number: line + 1, text, marks };
  });
  return { lines: derived, droppedOverlaps };
}

function precedes(a: Mark, b: Mark): boolean {
  return a.offset < b.offset || (a.offset === b.offset && a.original.length <= b.original.length);
}

function withoutOverlaps(marks: readonly Mark[]): Mark[] {
  const sorted: Mark[] = [];
  for (const mark of marks) {
    let index = sorted.length;
    while (index > 0 && !precedes(at(sorted, index - 1), mark)) index -= 1;
    sorted.splice(index, 0, mark);
  }
  const kept: Mark[] = [];
  let end = 0;
  for (const mark of sorted) {
    if (mark.offset < end) continue;
    kept.push(mark);
    end = mark.offset + mark.original.length;
  }
  return kept;
}
