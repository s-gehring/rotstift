import { describe, expect, it } from 'vitest';
import { topAt } from './band.ts';
import { locateLines } from './locate-lines.ts';
import { median } from './signal.ts';
import { iou, renderPage, sampleLines, type PageSpec, type SyntheticPage } from './synthetic.ts';
import type { BBox, LayoutResult, LineLocation } from './types.ts';

interface Score {
  readonly hits: number;
  readonly total: number;
  readonly meanIou: number;
  readonly detected: number;
}

function processorMilliseconds(work: () => void): number {
  const before = process.cpuUsage();
  work();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

function bandSpread(page: SyntheticPage, result: LayoutResult): number {
  const deviations: number[] = [];
  page.cores.forEach((core, index) => {
    const band = result.lines[index]?.bbox.band;
    if (core === null || band === undefined) return;
    const offsets = core.map((point) => point.y - topAt(band, point.x));
    const middle = offsets.toSorted((a, b) => a - b)[offsets.length >> 1] ?? 0;
    deviations.push(...offsets.map((offset) => Math.abs(offset - middle)));
  });
  return deviations.reduce((sum, value) => sum + value, 0) / deviations.length;
}

function score(spec: PageSpec, transcript = spec.lines): Score & { skew: number; spread: number } {
  const page = renderPage(spec);
  const result = locateLines(page.image, transcript);
  let hits = 0;
  let total = 0;
  let sum = 0;
  page.truth.forEach((box, index) => {
    if (box === null) return;
    total += 1;
    const found = result.lines[index];
    const overlap = found === null || found === undefined ? 0 : iou(box, found.bbox);
    sum += overlap;
    if (overlap >= 0.5) hits += 1;
  });
  return {
    hits,
    total,
    meanIou: sum / total,
    detected: result.detectedLines,
    skew: result.skewDegrees,
    spread: bandSpread(page, result),
  };
}

function overlapOf(truth: BBox | null | undefined, found: LineLocation | null | undefined): number {
  return truth == null || found == null ? 0 : iou(truth, found.bbox);
}

const BASE = { width: 1000, height: 1400, pitch: 52, seed: 7 } as const;

describe('locateLines on synthetic pages', () => {
  it('finds every line of a clean page', () => {
    const outcome = score({ ...BASE, lines: sampleLines(3, 24) });
    expect(outcome.hits).toBe(outcome.total);
    expect(outcome.meanIou).toBeGreaterThan(0.85);
    expect(outcome.detected).toBe(24);
  });

  it('ignores ruling and margin lines', () => {
    const outcome = score({ ...BASE, lines: sampleLines(4, 24), ruled: true, margin: true });
    expect(outcome.hits).toBe(outcome.total);
    expect(outcome.meanIou).toBeGreaterThan(0.8);
    expect(outcome.detected).toBe(24);
  });

  it('follows a skewed page and reports the angle', () => {
    const outcome = score({
      ...BASE,
      lines: sampleLines(5, 24),
      ruled: true,
      margin: true,
      skewDegrees: 2.5,
    });
    expect(outcome.hits).toBe(outcome.total);
    expect(outcome.meanIou).toBeGreaterThan(0.8);
    expect(outcome.skew).toBeCloseTo(2.5, 0);
  });

  it('separates lines whose ascenders and descenders touch', () => {
    const outcome = score({ ...BASE, lines: sampleLines(6, 24), longStrokes: true });
    expect(outcome.hits).toBe(outcome.total);
    expect(outcome.meanIou).toBeGreaterThan(0.8);
  });

  it('follows wavy baselines on ruled paper', () => {
    const outcome = score({
      ...BASE,
      lines: sampleLines(7, 24),
      ruled: true,
      wobble: 6,
      drift: 0.02,
    });
    expect(outcome.hits).toBe(outcome.total);
    expect(outcome.meanIou).toBeGreaterThan(0.8);
  });

  it('follows lines that each have their own slope and a slight wave', () => {
    const lines = sampleLines(22, 10);
    const outcome = score({ ...BASE, height: 640, seed: 2, lines, lineSlopes: 3, wobble: 6 });
    expect(outcome.hits).toBe(outcome.total);
    expect(outcome.detected).toBe(10);
    expect(outcome.spread).toBeLessThan(1.5);
  });

  it('separates small, dense lines of different slopes', () => {
    const lines = sampleLines(30, 16, 40, 60);
    const spec = { ...BASE, height: 700, pitch: 34, seed: 5, lines, lineSlopes: 2, wobble: 3 };
    const outcome = score(spec);
    expect(outcome.hits).toBe(outcome.total);
    expect(outcome.detected).toBe(16);
    expect(outcome.spread).toBeLessThan(1.5);
  });

  it('keeps the band level on straight lines', () => {
    const lines = sampleLines(5, 10);
    expect(score({ ...BASE, height: 640, lines }).spread).toBeLessThan(0.5);
    expect(
      score({ ...BASE, height: 640, lines, ruled: true, skewDegrees: 2.5 }).spread,
    ).toBeLessThan(0.5);
  });

  it('spreads a transcript line that holds a whole paragraph over its rows', () => {
    const lines = sampleLines(12, 10);
    const page = renderPage({ ...BASE, lines: ['Mein Tag', '', ...lines] });
    const result = locateLines(page.image, ['Mein Tag', '', lines.join(' ')]);
    const rows = result.lines[2]?.bbox.rows ?? [];
    expect(rows).toHaveLength(10);
    rows.forEach((row, index) => {
      expect(iou(row, page.truth[index + 2] ?? row)).toBeGreaterThan(0.5);
    });
    expect(rows[0]?.from).toBe(0);
    expect(rows[9]?.to).toBe(1);
    expect(result.lines[0]?.rough).toBeUndefined();
  });

  it('places unmatched transcript lines roughly instead of dropping them', () => {
    const page = renderPage({ ...BASE, lines: sampleLines(13, 12) });
    const transcript = ['ganz', 'anders', 'als', 'die', 'Seite'];
    const result = locateLines(page.image, transcript);
    expect(result.lines.every((line) => line !== null)).toBe(true);
    expect(result.lines.every((line) => line?.rough === true)).toBe(true);
  });

  it('handles a heading, empty lines and stray marks', () => {
    const lines = sampleLines(3, 24);
    lines[0] = 'Mein Tag';
    lines[5] = '';
    lines[6] = '';
    const outcome = score({ ...BASE, lines, headings: [0], ruled: true, strays: 2 });
    expect(outcome.hits).toBe(outcome.total);
    expect(outcome.detected).toBe(22);
  });

  it('works on a small page and a short last line', () => {
    const lines = sampleLines(8, 12, 14, 26);
    lines[11] = 'Ende';
    const outcome = score({ width: 600, height: 700, pitch: 40, seed: 3, lines, ruled: true });
    expect(outcome.hits).toBe(outcome.total);
  });

  it('returns null for blank transcript lines and keeps the rest in place', () => {
    const lines = sampleLines(9, 10);
    const withBlank = [...lines.slice(0, 4), '', ...lines.slice(4)];
    const page = renderPage({ ...BASE, lines: withBlank, ruled: true });
    const result = locateLines(page.image, withBlank);
    expect(result.lines[4]).toBeNull();
    expect(result.lines).toHaveLength(11);
    withBlank.forEach((_, index) => {
      if (index === 4) return;
      expect(overlapOf(page.truth[index], result.lines[index])).toBeGreaterThan(0.5);
    });
  });

  it('returns nulls for an empty page', () => {
    const page = renderPage({ ...BASE, lines: ['', ''], ruled: true, margin: true });
    const result = locateLines(page.image, ['Hallo Welt', 'noch eine Zeile']);
    expect(result.detectedLines).toBe(0);
    expect(result.lines).toEqual([null, null]);
  });

  it('stays well under a second for an A4 page', () => {
    const lines = sampleLines(11, 32);
    const page = renderPage({
      width: 1240,
      height: 1754,
      pitch: 52,
      seed: 2,
      lines,
      ruled: true,
      margin: true,
      skewDegrees: 1,
    });
    locateLines(page.image, lines);
    const runs = [0, 1, 2, 3, 4].map(() =>
      processorMilliseconds(() => locateLines(page.image, lines)),
    );
    process.stdout.write(`A4 locateLines CPU ms: ${runs.map((run) => run.toFixed(0)).join(' ')}\n`);
    expect(median(runs)).toBeLessThan(1000);
  });
});
