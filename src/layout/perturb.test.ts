import { describe, expect, it } from 'vitest';
import { locateLines } from './locate-lines.ts';
import { paintOver, scoreVariant, sumScores, variantsOf } from './perturb.ts';
import { renderPage, sampleLines } from './synthetic.ts';

const BASE = { width: 1000, height: 1400, pitch: 52 } as const;

function pageOf(seed: number) {
  const lines = [...sampleLines(seed, 8, 20, 50), '', ...sampleLines(seed + 100, 8, 20, 50)];
  const page = renderPage({ ...BASE, seed, lines, ruled: true, margin: seed % 2 === 0 });
  const truth = lines.map((text, index) => ({ text, bbox: page.truth[index] ?? null }));
  return { page, truth };
}

describe('perturbed transcripts on synthetic pages', () => {
  const seeds = [3, 4, 5, 6, 7, 8];
  const scores = new Map<string, ReturnType<typeof scoreVariant>[]>();
  for (const seed of seeds) {
    const { page, truth } = pageOf(seed);
    for (const variant of variantsOf(truth)) {
      const image = { ...page.image, data: new Uint8ClampedArray(page.image.data) };
      if (variant.erased !== null) paintOver(image, variant.erased, 245);
      const found = locateLines(image, variant.transcript).lines;
      const list = scores.get(variant.name) ?? [];
      list.push(scoreVariant(variant, found));
      scores.set(variant.name, list);
    }
  }

  it('finds every line when the transcript matches the page', () => {
    const total = sumScores(scores.get('unverändert') ?? []);
    expect(total.correct).toBe(total.expected);
    expect(total.wrong).toBe(0);
    expect(total.spurious).toBe(0);
  });

  for (const [name, list] of scores) {
    it(`rarely returns a confident wrong box: ${name}`, () => {
      const total = sumScores(list);
      expect(total.wrong / total.expected).toBeLessThan(0.03);
      expect(total.spurious / total.expected).toBeLessThan(0.03);
    });
  }

  it('returns a confident wrong box for less than one percent of all lines', () => {
    const total = sumScores([...scores.values()].flat());
    expect(total.wrong / total.expected).toBeLessThan(0.01);
  });

  it('keeps most lines when only one transcript line differs', () => {
    for (const name of ['mittlere Zeile fehlt im Transkript', 'Zeile in der Mitte eingefügt']) {
      const total = sumScores(scores.get(name) ?? []);
      expect(total.correct / total.expected).toBeGreaterThan(0.5);
    }
  });
});
