export const FIX_EM_PER_UNIT = 0.37;

const NARROW = new Set("ijl|!:;'’`");
const SMALL_PUNCTUATION = new Set('.,');
const SLIM = new Set('tfrI');
const WIDE = new Set('mwMW');
const SPACE = new Set('  ');

export function charUnits(char: string): number {
  if (SPACE.has(char)) return 0.65;
  if (NARROW.has(char)) return 0.5;
  if (SMALL_PUNCTUATION.has(char)) return 0.55;
  if (SLIM.has(char)) return 0.75;
  if (WIDE.has(char)) return char === char.toLowerCase() ? 1.6 : 2;
  if (/\p{Lu}/u.test(char)) return 1.4;
  if (/\p{Nd}/u.test(char)) return 1.2;
  return 1;
}

export function textUnits(text: string): number {
  let total = 0;
  for (const char of text) total += charUnits(char);
  return total;
}

export function estimateTextWidth(text: string, size: number): number {
  return textUnits(text) * FIX_EM_PER_UNIT * size;
}
