import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveMarks } from '../src/correction/derive.ts';
import { goldFromMarkup } from './gold.ts';
import { scorePage } from './mark-metrics.ts';
import { PROFILE_SETS } from './profiles.ts';

const root = join(import.meta.dirname, 'samples', 'profiles');

function texts(dir: string): string[] {
  const folder = join(root, dir);
  return readdirSync(folder)
    .filter((name) => name.endsWith('.txt'))
    .toSorted()
    .map((name) => readFileSync(join(folder, name), 'utf8').trim());
}

const unreachable: Record<string, number> = { fr: 0, es: 0, sachfach: 1 };
const typedCeiling: Record<string, number> = { fr: 35, es: 42, sachfach: 14 };

describe.each(['fr', 'es', 'sachfach'])('perfect corrections of the %s texts', (key) => {
  const entry = PROFILE_SETS[key];
  if (!entry) throw new Error(key);
  const totals = { gold: 0, located: 0, typed: 0, predicted: 0 };
  for (const markup of texts(entry.dir)) {
    const { input, gold, corrected } = goldFromMarkup(markup);
    const lines = deriveMarks(
      input.lines.map((line) => line.text),
      corrected,
      { profile: entry.profile },
    );
    const score = scorePage(input, gold, { lines });
    totals.gold += score.gold;
    totals.located += score.matched + score.wrongType;
    totals.typed += score.matched;
    totals.predicted += score.predicted;
  }

  it('locate every error', () => {
    expect(totals.gold - totals.located).toBe(unreachable[key]);
    expect(totals.predicted).toBe(totals.located);
  });

  it('type the marks like the gold marks as far as the word comparison allows', () => {
    expect(totals.typed).toBe(typedCeiling[key]);
  });
});

describe('texts without errors', () => {
  it.each(['fr', 'es', 'en', 'sachfach'])('get no marks for %s', (key) => {
    const entry = PROFILE_SETS[key];
    if (!entry) throw new Error(key);
    for (const markup of texts(entry.dir)) {
      const clean = goldFromMarkup(markup.replaceAll(/\{[^{}|]*\|([^{}|]*)\|[A-Za-z]+\}/g, '$1'));
      const lines = deriveMarks(
        clean.input.lines.map((line) => line.text),
        clean.corrected,
        { profile: entry.profile },
      );
      expect(lines.flatMap((line) => line.marks)).toEqual([]);
    }
  });
});
