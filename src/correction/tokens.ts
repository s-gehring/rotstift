import { at } from './at.ts';
import { continuesHyphenation } from '../stats/statistics.ts';

export type TokenKind = 'word' | 'punct';

export interface Span {
  line: number;
  start: number;
  end: number;
}

export interface OriginalToken {
  text: string;
  kind: TokenKind;
  parts: Span[];
}

export interface CorrectedToken {
  text: string;
  kind: TokenKind;
  start: number;
  end: number;
}

const TOKEN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;
const WORD_START = /^[\p{L}\p{N}]/u;

function kindOf(text: string): TokenKind {
  return WORD_START.test(text) ? 'word' : 'punct';
}

export function tokenizeLines(lines: readonly string[]): OriginalToken[][] {
  const perLine = lines.map((text, line) =>
    Array.from(text.matchAll(TOKEN), (match): OriginalToken => {
      const start = match.index;
      return {
        text: match[0],
        kind: kindOf(match[0]),
        parts: [{ line, start, end: start + match[0].length }],
      };
    }),
  );
  for (let line = 0; line + 1 < perLine.length; line += 1) {
    joinHyphenation(lines, perLine, line);
  }
  return perLine;
}

function joinHyphenation(lines: readonly string[], perLine: OriginalToken[][], line: number) {
  const tokens = at(perLine, line);
  const next = at(perLine, line + 1);
  const hyphen = tokens.at(-1);
  const head = tokens.at(-2);
  const tail = next[0];
  if (hyphen?.text !== '-' || head?.kind !== 'word' || tail?.kind !== 'word') return;
  const hyphenSpan = at(hyphen.parts, 0);
  const headEnd = at(head.parts, head.parts.length - 1).end;
  if (headEnd !== hyphenSpan.start) return;
  if (!continuesHyphenation(at(lines, line), at(lines, line + 1))) return;
  head.text += tail.text;
  head.parts.push(...tail.parts);
  tokens.pop();
  next.shift();
}

export function joinCorrected(text: string): string {
  const parts: string[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === '') continue;
    const previous = parts.at(-1);
    if (previous !== undefined && continuesHyphenation(previous, line)) {
      parts[parts.length - 1] = previous.slice(0, -1) + line;
    } else {
      parts.push(line);
    }
  }
  return parts.join(' ').replaceAll(/\s+/gu, ' ');
}

export function tokenizeCorrected(joined: string): CorrectedToken[] {
  return Array.from(joined.matchAll(TOKEN), (match) => ({
    text: match[0],
    kind: kindOf(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}
