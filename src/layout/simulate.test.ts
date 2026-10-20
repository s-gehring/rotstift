import { describe, expect, it } from 'vitest';
import { assignLines } from './assign.ts';
import { simulatePage, tally, type SimulationTotals } from './simulate.ts';

function run(spread: number, pages: number): Map<string, SimulationTotals & { ms: number }> {
  const totals = new Map<string, SimulationTotals & { ms: number }>();
  for (let seed = 1; seed <= pages; seed += 1) {
    const page = simulatePage(seed, 20, spread);
    for (const variant of page.variants) {
      const started = performance.now();
      const found = assignLines(page.candidates, variant.transcript);
      const ms = performance.now() - started;
      const t = tally(variant.expected, found, page.candidates);
      const before = totals.get(variant.name);
      totals.set(variant.name, {
        lines: (before?.lines ?? 0) + t.lines,
        correct: (before?.correct ?? 0) + t.correct,
        wrong: (before?.wrong ?? 0) + t.wrong,
        wrongConfident: (before?.wrongConfident ?? 0) + t.wrongConfident,
        missing: (before?.missing ?? 0) + t.missing,
        ms: (before?.ms ?? 0) + ms,
      });
    }
  }
  return totals;
}

describe.each([
  [0.08, 80],
  [0.15, 150],
])(
  'simulated pages with a width spread of %s',
  (spread, pages) => {
    const totals = run(spread, pages);
    const share = (name: string, pick: (t: SimulationTotals) => number) => {
      const t = totals.get(name);
      return t === undefined ? 1 : pick(t) / t.lines;
    };

    it('assigns almost every line of a clean page', () => {
      expect(share('sauber', (t) => t.missing)).toBeLessThan(0.05);
      expect(share('sauber', (t) => t.wrong)).toBe(0);
    });

    it('keeps the uncertainty local when one transcript line is missing', () => {
      expect(share('eine Zeile fehlt', (t) => t.missing)).toBeLessThan(0.2);
      expect(share('erste Zeile fehlt', (t) => t.missing)).toBeLessThan(0.2);
      expect(share('letzte Zeile fehlt', (t) => t.missing)).toBeLessThan(0.2);
    });

    it('almost never returns a confident wrong box', () => {
      for (const name of totals.keys()) {
        expect(share(name, (t) => t.wrongConfident)).toBeLessThan(0.01);
      }
    });

    it('stays fast for 20 lines', () => {
      for (const t of totals.values()) expect(t.ms / pages).toBeLessThan(100);
    });
  },
  60_000,
);
