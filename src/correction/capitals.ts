import type { LanguageCode } from '../annotations/catalog.ts';
import { align } from './align.ts';
import type { Op } from './align.ts';
import { tokenizeCorrected, tokenizeLines } from './tokens.ts';
import type { CorrectedToken, OriginalToken } from './tokens.ts';

export const MAX_LOWERED_SHARE = 0.25;

const SENTENCE_END = new Set(['.', '!', '?']);

export interface Lowering {
  readonly original: string;
  readonly corrected: CorrectedToken;
  readonly sentenceStart: boolean;
}

export interface CapitalsCheck {
  readonly capitalized: number;
  readonly lowered: readonly Lowering[];
  readonly collapsed: boolean;
}

function isUpper(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase();
}

function lowers(o: OriginalToken, c: CorrectedToken): boolean {
  const first = o.text.charAt(0);
  const replaced = c.text.charAt(0);
  return isUpper(first) && replaced !== first && replaced.toUpperCase() === first;
}

export function checkCapitals(ops: readonly Op[], language: LanguageCode): CapitalsCheck {
  const lowered: Lowering[] = [];
  let capitalized = 0;
  let previous: OriginalToken | null = null;
  for (const op of ops) {
    if (op.type === 'ins') continue;
    const { o } = op;
    const sentenceStart = previous === null || SENTENCE_END.has(previous.text);
    previous = o;
    if (o.kind !== 'word' || !isUpper(o.text.charAt(0))) continue;
    if (!sentenceStart) capitalized += 1;
    if (op.type === 'sub' && op.c.kind === 'word' && lowers(o, op.c)) {
      lowered.push({ original: o.text, corrected: op.c, sentenceStart });
    }
  }
  const midSentence = lowered.filter((lowering) => !lowering.sentenceStart).length;
  const collapsed =
    lowered.some((lowering) => lowering.sentenceStart) ||
    (language === 'de' && midSentence > 1 && midSentence > MAX_LOWERED_SHARE * capitalized);
  return { capitalized, lowered, collapsed };
}

export function keepCapitals(
  lines: readonly string[],
  joined: string,
  language: LanguageCode,
): string {
  const ops = align(tokenizeLines(lines).flat(), tokenizeCorrected(joined));
  const { lowered, collapsed } = checkCapitals(ops, language);
  if (!collapsed) return joined;
  let result = joined;
  for (const { original, corrected } of lowered) {
    result =
      result.slice(0, corrected.start) + original.charAt(0) + result.slice(corrected.start + 1);
  }
  return result;
}
