import { at } from './at.ts';

export function editDistance(a: string, b: string): number {
  const cols = b.length + 1;
  const table = new Int32Array((a.length + 1) * cols);
  for (let i = 0; i <= a.length; i += 1) table[i * cols] = i;
  for (let j = 0; j <= b.length; j += 1) table[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        at(table, (i - 1) * cols + j) + 1,
        at(table, i * cols + j - 1) + 1,
        at(table, (i - 1) * cols + j - 1) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(table, (i - 2) * cols + j - 2) + 1);
      }
      table[i * cols + j] = best;
    }
  }
  return at(table, a.length * cols + b.length);
}

export function isSimilar(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const longest = Math.max(left.length, right.length);
  const allowed = Math.max(1, Math.floor(longest * 0.4));
  if (Math.abs(left.length - right.length) > allowed) return false;
  return editDistance(left, right) <= allowed;
}
