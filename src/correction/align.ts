import { at } from './at.ts';
import { isSimilar } from './edit-distance.ts';
import type { CorrectedToken, OriginalToken } from './tokens.ts';

export type Op =
  | { type: 'match'; o: OriginalToken; c: CorrectedToken }
  | { type: 'sub'; o: OriginalToken; c: CorrectedToken }
  | { type: 'del'; o: OriginalToken }
  | { type: 'ins'; c: CorrectedToken };

const GAP = -2;
const EXACT = 3;
const CASE_ONLY = 2;
const SIMILAR = 1;
const PUNCTUATION = 0;
const DIFFERENT = -1;

function pairScore(o: OriginalToken, c: CorrectedToken): number | null {
  if (o.kind !== c.kind) return null;
  if (o.text === c.text) return EXACT;
  if (o.kind === 'punct') return PUNCTUATION;
  if (o.text.toLowerCase() === c.text.toLowerCase()) return CASE_ONLY;
  return isSimilar(o.text, c.text) ? SIMILAR : DIFFERENT;
}

export function align(original: readonly OriginalToken[], corrected: readonly CorrectedToken[]) {
  const rows = original.length + 1;
  const cols = corrected.length + 1;
  const score = new Int32Array(rows * cols);
  for (let i = 1; i < rows; i += 1) score[i * cols] = i * GAP;
  for (let j = 1; j < cols; j += 1) score[j] = j * GAP;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const pair = pairScore(at(original, i - 1), at(corrected, j - 1));
      let best = Math.max(at(score, (i - 1) * cols + j), at(score, i * cols + j - 1));
      best += GAP;
      if (pair !== null) best = Math.max(best, at(score, (i - 1) * cols + j - 1) + pair);
      score[i * cols + j] = best;
    }
  }

  const ops: Op[] = [];
  let i = original.length;
  let j = corrected.length;
  while (i > 0 || j > 0) {
    const here = at(score, i * cols + j);
    const o = original[i - 1];
    const c = corrected[j - 1];
    const pair = o !== undefined && c !== undefined ? pairScore(o, c) : null;
    if (
      o !== undefined &&
      c !== undefined &&
      pair !== null &&
      here === at(score, (i - 1) * cols + j - 1) + pair
    ) {
      ops.push({ type: pair === EXACT ? 'match' : 'sub', o, c });
      i -= 1;
      j -= 1;
    } else if (o !== undefined && here === at(score, (i - 1) * cols + j) + GAP) {
      ops.push({ type: 'del', o });
      i -= 1;
    } else if (c !== undefined) {
      ops.push({ type: 'ins', c });
      j -= 1;
    } else {
      throw new Error('Alignment traceback left the table');
    }
  }
  return Array.from({ length: ops.length }, (_, index) => at(ops, ops.length - 1 - index));
}
