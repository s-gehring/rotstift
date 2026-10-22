import { describe, expect, it } from 'vitest';
import { readStruck } from '../annotations/struck.ts';
import { demoCorrection, DEMO_PAGES, matchSignature, signatureDistance } from './demo-class.ts';

describe('DEMO_PAGES', () => {
  it('has one corrected line for every transcript line and a box for each', () => {
    for (const page of DEMO_PAGES) {
      expect(page.corrected).toHaveLength(page.lines.length);
      expect(page.lines.every((line) => line.trim() !== '')).toBe(true);
    }
  });

  it('shows struck words and a class of three to four Arbeiten', () => {
    const struck = DEMO_PAGES.flatMap((page) => page.lines).flatMap(
      (line) => readStruck(line).struck,
    );
    expect(struck.length).toBeGreaterThan(0);
    const arbeiten = new Set(DEMO_PAGES.map((page) => page.arbeit));
    expect(arbeiten.size).toBeGreaterThanOrEqual(3);
    expect(arbeiten.size).toBeLessThanOrEqual(4);
  });
});

describe('demoCorrection', () => {
  it('returns the corrected text for the visible lines of a demo page', () => {
    const page = DEMO_PAGES[0];
    if (page === undefined) throw new Error('no demo page');
    const visible = page.lines.map((line) => readStruck(line).text.replaceAll(/\s+/gu, ' ').trim());
    const corrected = demoCorrection(page.lines);
    expect(corrected).toBe(page.corrected.join('\n'));
    expect(demoCorrection(visible)).toBeNull();
  });

  it('knows nothing about other lines', () => {
    expect(demoCorrection(['Das war alles.'])).toBeNull();
  });
});

describe('matchSignature', () => {
  const known = [
    { page: 'a', signature: Uint8Array.from([10, 10, 200, 200]) },
    { page: 'b', signature: Uint8Array.from([200, 200, 10, 10]) },
  ];

  it('picks the closest page within the limit', () => {
    expect(matchSignature(Uint8Array.from([12, 9, 198, 201]), known, 5)).toBe('a');
    expect(matchSignature(Uint8Array.from([198, 202, 12, 8]), known, 5)).toBe('b');
  });

  it('rejects a page that is too far from every known one', () => {
    expect(matchSignature(Uint8Array.from([100, 100, 100, 100]), known, 5)).toBeNull();
  });

  it('measures the mean absolute difference and refuses different sizes', () => {
    expect(signatureDistance(Uint8Array.from([0, 10]), Uint8Array.from([4, 6]))).toBe(4);
    expect(signatureDistance(Uint8Array.from([0]), Uint8Array.from([0, 0]))).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
