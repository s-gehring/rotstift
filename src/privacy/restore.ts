import type { CorrectionProfile } from '../annotations/profile.ts';
import type { ContentResult } from '../content-form/review.ts';
import { at } from '../correction/at.ts';
import { deriveMarks } from '../correction/derive.ts';
import { PLACEHOLDER, type PseudonymizedPage, type Replacement } from './pseudonymize.ts';
import { PLACEHOLDER_LABELS } from './types.ts';

const LABELS = Object.values(PLACEHOLDER_LABELS).join('|');
const SENT_TOKEN = new RegExp(
  String.raw`\[(?:${LABELS}) \d+\]|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]`,
  'gu',
);
const PLAIN_TOKEN = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
const BROKEN_PLACEHOLDER = new RegExp(
  String.raw`\[\s*(?:${LABELS})|(?:${LABELS})\s*\d+\s*\]`,
  'iu',
);
const GLUE = /[\p{L}\p{N}'’-]/u;
const MAX_CELLS = 25_000_000;

interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly replacement: Located | null;
}

interface Located {
  readonly sentStart: number;
  readonly sentEnd: number;
  readonly start: number;
  readonly end: number;
  readonly original: string;
}

interface Gap {
  readonly sent: readonly [number, number];
  readonly answer: readonly [number, number];
  readonly original: readonly [number, number];
  readonly changed: boolean;
  readonly protect: boolean;
}

function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let position = 0;
  for (const line of lines) {
    starts.push(position);
    position += line.length + 1;
  }
  return starts;
}

function locate(page: PseudonymizedPage): Located[] {
  const sentStarts = lineStarts(page.lines);
  const originalStarts = lineStarts(page.original);
  return page.replacements
    .map((replacement: Replacement): Located => {
      const sentStart = (sentStarts[replacement.line - 1] ?? 0) + replacement.sentOffset;
      const start = (originalStarts[replacement.line - 1] ?? 0) + replacement.offset;
      return {
        sentStart,
        sentEnd: sentStart + replacement.placeholder.length,
        start,
        end: start + replacement.length,
        original: replacement.original,
      };
    })
    .toSorted((a, b) => a.sentStart - b.sentStart);
}

function tokenizeSent(text: string, located: readonly Located[]): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  const plain = (from: number, to: number) => {
    for (const match of text.slice(from, to).matchAll(PLAIN_TOKEN)) {
      const start = from + match.index;
      tokens.push({ text: match[0], start, end: start + match[0].length, replacement: null });
    }
  };
  for (const replacement of located) {
    plain(cursor, replacement.sentStart);
    tokens.push({
      text: text.slice(replacement.sentStart, replacement.sentEnd),
      start: replacement.sentStart,
      end: replacement.sentEnd,
      replacement,
    });
    cursor = replacement.sentEnd;
  }
  plain(cursor, text.length);
  return tokens;
}

function tokenizeAnswer(text: string): Token[] {
  return Array.from(text.matchAll(SENT_TOKEN), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
    replacement: null,
  }));
}

const isPlaceholder = (token: Token) => token.text.length > 1 && token.text.startsWith('[');

function sameToken(sent: Token, answer: Token): boolean {
  return sent.text === answer.text && (sent.replacement !== null) === isPlaceholder(answer);
}

function matchTokens(sent: readonly Token[], answer: readonly Token[]): [number, number][] | null {
  let head = 0;
  while (
    head < sent.length &&
    head < answer.length &&
    sameToken(at(sent, head), at(answer, head))
  ) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < sent.length - head &&
    tail < answer.length - head &&
    sameToken(at(sent, sent.length - 1 - tail), at(answer, answer.length - 1 - tail))
  ) {
    tail += 1;
  }
  const rows = sent.length - head - tail;
  const cols = answer.length - head - tail;
  if ((rows + 1) * (cols + 1) > MAX_CELLS) return null;
  const table = new Int32Array((rows + 1) * (cols + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      table[i * (cols + 1) + j] = sameToken(at(sent, head + i), at(answer, head + j))
        ? (table[(i + 1) * (cols + 1) + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * (cols + 1) + j] ?? 0, table[i * (cols + 1) + j + 1] ?? 0);
    }
  }
  const pairs: [number, number][] = [];
  for (let k = 0; k < head; k += 1) pairs.push([k, k]);
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (sameToken(at(sent, head + i), at(answer, head + j))) {
      pairs.push([head + i, head + j]);
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * (cols + 1) + j] ?? 0) >= (table[i * (cols + 1) + j + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  for (let k = tail; k > 0; k -= 1) pairs.push([sent.length - k, answer.length - k]);
  return pairs;
}

function originalPosition(located: readonly Located[], position: number): number {
  let shift = 0;
  for (const replacement of located) {
    if (replacement.sentEnd > position) break;
    shift += replacement.end - replacement.start - (replacement.sentEnd - replacement.sentStart);
  }
  return position + shift;
}

function glued(text: string, atStart: boolean): boolean {
  const char = atStart ? text.charAt(0) : text.charAt(text.length - 1);
  return char !== '' && GLUE.test(char);
}

function buildGaps(
  sentText: string,
  answerText: string,
  sent: readonly Token[],
  answer: readonly Token[],
  pairs: readonly [number, number][],
  located: readonly Located[],
): Gap[] {
  const gaps: Gap[] = [];
  for (let k = 0; k <= pairs.length; k += 1) {
    const left = pairs[k - 1];
    const right = pairs[k];
    const sentFrom = left === undefined ? 0 : (sent[left[0]]?.end ?? 0);
    const sentTo = right === undefined ? sentText.length : (sent[right[0]]?.start ?? 0);
    const answerFrom = left === undefined ? 0 : (answer[left[1]]?.end ?? 0);
    const answerTo = right === undefined ? answerText.length : (answer[right[1]]?.start ?? 0);
    const sentTokens = sent.slice(left === undefined ? 0 : left[0] + 1, right?.[0] ?? sent.length);
    const answerTokens = answer.slice(
      left === undefined ? 0 : left[1] + 1,
      right?.[1] ?? answer.length,
    );
    const sentGap = sentText.slice(sentFrom, sentTo);
    const answerGap = answerText.slice(answerFrom, answerTo);
    const leftPlaceholder = left !== undefined && (sent[left[0]]?.replacement ?? null) !== null;
    const rightPlaceholder = right !== undefined && (sent[right[0]]?.replacement ?? null) !== null;
    const changed = sentTokens.length > 0 || answerTokens.length > 0;
    const protect =
      changed &&
      (sentTokens.some((token) => token.replacement !== null) ||
        answerTokens.some(isPlaceholder) ||
        BROKEN_PLACEHOLDER.test(answerGap) ||
        (leftPlaceholder && (glued(sentGap, true) || glued(answerGap, true))) ||
        (rightPlaceholder && (glued(sentGap, false) || glued(answerGap, false))));
    gaps.push({
      sent: [sentFrom, sentTo],
      answer: [answerFrom, answerTo],
      original: [originalPosition(located, sentFrom), originalPosition(located, sentTo)],
      changed,
      protect,
    });
  }
  return gaps;
}

function offendingMarks(
  original: readonly string[],
  text: string,
  located: readonly Located[],
  profile: CorrectionProfile,
): [number, number][] {
  const starts = lineStarts(original);
  return deriveMarks(original, text, { profile }).flatMap((line, index) =>
    line.marks.flatMap((mark): [number, number][] => {
      const start = (starts[index] ?? 0) + mark.offset;
      const end = start + mark.original.length;
      const touches = located.some((replacement) =>
        mark.kind === 'omission'
          ? replacement.start < start && start < replacement.end
          : start < replacement.end && replacement.start < end,
      );
      return touches ? [[start, end]] : [];
    }),
  );
}

export function restoreCorrection(
  page: PseudonymizedPage,
  correctedText: string,
  profile?: CorrectionProfile,
): string | null {
  const located = locate(page);
  const sentText = page.lines.join('\n');
  const originalText = page.original.join('\n');
  const sent = tokenizeSent(sentText, located);
  const answer = tokenizeAnswer(correctedText);
  const pairs = matchTokens(sent, answer);
  if (pairs === null) return null;
  const gaps = buildGaps(sentText, correctedText, sent, answer, pairs, located);
  const reverted = gaps.map((gap) => gap.protect);

  const emit = () => {
    let text = '';
    gaps.forEach((gap, index) => {
      text +=
        gap.changed && reverted[index] === true
          ? originalText.slice(gap.original[0], gap.original[1])
          : correctedText.slice(gap.answer[0], gap.answer[1]);
      const pair = pairs[index];
      if (pair === undefined) return;
      const token = sent[pair[0]];
      text += token?.replacement?.original ?? answer[pair[1]]?.text ?? '';
    });
    return text;
  };

  let text = emit();
  if (profile === undefined) return text;
  for (let round = 0; round <= gaps.length; round += 1) {
    const offending = offendingMarks(page.original, text, located, profile);
    if (offending.length === 0) return text;
    const hit = gaps.flatMap((gap, index) =>
      gap.changed &&
      reverted[index] !== true &&
      offending.some(([start, end]) => gap.original[0] <= end && start <= gap.original[1])
        ? [index]
        : [],
    );
    if (hit.length === 0) return originalText;
    for (const index of hit) reverted[index] = true;
    text = emit();
  }
  return originalText;
}

export function restorePlaceholders(text: string, originals: ReadonlyMap<string, string>): string {
  return text.replaceAll(PLACEHOLDER, (placeholder) => originals.get(placeholder) ?? placeholder);
}

export function restoreReview(
  result: ContentResult,
  originals: ReadonlyMap<string, string>,
): ContentResult {
  if (!result.ok) return result;
  return {
    ...result,
    comments: result.comments.map((comment) => ({
      ...comment,
      text: restorePlaceholders(comment.text, originals),
    })),
  };
}
