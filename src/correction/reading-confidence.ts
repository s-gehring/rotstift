import type { Mark } from '../annotations/transcript.ts';

export interface TokenProbability {
  bytes: readonly number[];
  logprob: number;
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

export function charProbabilities(
  content: string,
  tokens: readonly TokenProbability[],
): number[] | null {
  const bytes: number[] = [];
  const owner: number[] = [];
  tokens.forEach((token, index) => {
    for (const byte of token.bytes) {
      bytes.push(byte);
      owner.push(index);
    }
  });
  if (new TextDecoder().decode(new Uint8Array(bytes)) !== content) return null;
  const probabilities: number[] = [];
  let offset = 0;
  for (const char of content) {
    const length = utf8Length(char.codePointAt(0) ?? 0);
    let lowest = 1;
    for (let index = offset; index < offset + length; index += 1) {
      lowest = Math.min(lowest, Math.exp(tokens[owner[index] ?? -1]?.logprob ?? 0));
    }
    offset += length;
    for (let unit = 0; unit < char.length; unit += 1) probabilities.push(lowest);
  }
  return probabilities;
}

export function lineProbabilities(
  content: string,
  probabilities: readonly number[],
  lines: readonly string[],
): number[][] {
  let cursor = 0;
  return lines.map((line) => {
    const result = Array.from(line, () => 1);
    for (const match of line.matchAll(/\S+/gu)) {
      const found = content.indexOf(match[0], cursor);
      if (found === -1) continue;
      for (let index = 0; index < match[0].length; index += 1) {
        result[match.index + index] = probabilities[found + index] ?? 1;
      }
      cursor = found + match[0].length;
    }
    return result;
  });
}

function wordAround(line: string, position: number): [number, number] | null {
  for (const match of line.matchAll(/\S+/gu)) {
    if (match.index <= position && position < match.index + match[0].length) {
      return [match.index, match.index + match[0].length];
    }
  }
  return null;
}

function lowestIn(probabilities: readonly number[], start: number, end: number): number {
  let result = 1;
  for (let index = start; index < end; index += 1) {
    result = Math.min(result, probabilities[index] ?? 1);
  }
  return result;
}

export function markConfidence(line: string, probabilities: readonly number[], mark: Mark): number {
  if (mark.kind === 'omission') {
    const before = wordAround(line, mark.offset - 1);
    const after = wordAround(line, mark.offset);
    return Math.min(
      before ? lowestIn(probabilities, ...before) : 1,
      after ? lowestIn(probabilities, ...after) : 1,
    );
  }
  const first = wordAround(line, mark.offset);
  const last = wordAround(line, mark.offset + Math.max(0, mark.original.length - 1));
  const start = first?.[0] ?? mark.offset;
  const end = last?.[1] ?? mark.offset + mark.original.length;
  return lowestIn(probabilities, start, end);
}
