import type { PageReading } from './uncertain-reading.ts';

export const CONFIRMED_BELOW = 0.8;

const TAG = /<[^>]*>/gu;
const EDGE_MARKS = /^[*_#|>]+|[*_|]+$/gu;

function plainWords(lines: readonly string[]): string[] {
  return lines
    .join('\n')
    .replace(TAG, ' ')
    .split(/\s+/u)
    .map((word) => word.replace(EDGE_MARKS, ''))
    .filter(Boolean);
}

export function confirmedWords(first: readonly string[], second: readonly string[]): boolean[] {
  const rows = first.length + 1;
  const cols = second.length + 1;
  const cost = Array.from({ length: rows }, (_row, i) =>
    Array.from({ length: cols }, (_col, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const same = first[i - 1] === second[j - 1] ? 0 : 1;
      cost[i]![j] = Math.min(
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
        cost[i - 1]![j - 1]! + same,
      );
    }
  }
  const confirmed = first.map(() => false);
  let i = first.length;
  let j = second.length;
  while (i > 0 && j > 0) {
    const same = first[i - 1] === second[j - 1];
    if (same && cost[i]![j] === cost[i - 1]![j - 1]) {
      confirmed[i - 1] = true;
      i -= 1;
      j -= 1;
    } else if (cost[i]![j] === cost[i - 1]![j - 1]! + 1) {
      i -= 1;
      j -= 1;
    } else if (cost[i]![j] === cost[i - 1]![j]! + 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return confirmed;
}

export function confirmReading(reading: PageReading, second: readonly string[]): PageReading {
  const confirmed = confirmedWords(
    reading.lines.flat().map((word) => word.text),
    plainWords(second),
  );
  let index = 0;
  return {
    uncertainBelow: 1,
    lines: reading.lines.map((words) =>
      words.map((word) => {
        const sure = (confirmed[index] ?? false) && word.confidence >= CONFIRMED_BELOW;
        index += 1;
        return { text: word.text, confidence: sure ? 1 : 0 };
      }),
    ),
  };
}
