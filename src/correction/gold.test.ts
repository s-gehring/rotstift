import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './at.ts';
import { DEUTSCH } from '../annotations/profile.ts';
import { deriveMarks } from './derive.ts';
import { parseGold, scoreMarks, wrapText } from './gold.ts';
import type { FoundMark, GoldError, TypeScore } from './gold.ts';

const SAMPLES = new URL('../../eval/samples/texts/', import.meta.url);
const LINE_WIDTH = 42;

function loadSamples() {
  return readdirSync(SAMPLES)
    .filter((name) => name.endsWith('.txt'))

    .map((name) => ({ name, gold: parseGold(readFileSync(new URL(name, SAMPLES), 'utf8')) }));
}

function derive(written: string, corrected: string, width: number) {
  const { lines, starts } = wrapText(written, width);
  const marks: FoundMark[] = deriveMarks(lines, corrected, { profile: DEUTSCH }).flatMap((line) =>
    line.marks.map((mark) => ({
      type: mark.type,
      start: at(starts, line.number - 1) + mark.offset,
      end: at(starts, line.number - 1) + mark.offset + mark.original.length,
    })),
  );
  return marks;
}

function allScores(width: number): TypeScore[] {
  const errors: GoldError[] = [];
  const marks: FoundMark[] = [];
  let shift = 0;
  for (const { gold } of loadSamples()) {
    errors.push(...gold.errors.map((e) => ({ ...e, start: e.start + shift, end: e.end + shift })));
    marks.push(
      ...derive(gold.written, gold.corrected, width).map((m) => ({
        ...m,
        start: m.start + shift,
        end: m.end + shift,
      })),
    );
    shift += gold.written.length + 1;
  }
  return scoreMarks(errors, marks);
}

function format(scores: readonly TypeScore[]): string {
  return scores
    .map(
      (s) =>
        `${s.type.padEnd(3)} found ${String(s.found).padStart(2)} gold ${String(s.gold).padStart(2)} precision ${s.precision.toFixed(2)} recall ${s.recall.toFixed(2)}`,
    )
    .join('\n');
}

describe('deriveMarks on the gold samples', () => {
  it('finds the gold texts', () => {
    expect(loadSamples()).toHaveLength(4);
  });

  it.each([30, LINE_WIDTH, 80, 10_000])(
    'keeps precision and recall of R, Z and G high at line width %i',
    (width) => {
      const scores = allScores(width);
      console.info(`\nLine width ${width}\n${format(scores)}`);
      for (const type of ['R', 'Z', 'G']) {
        const score = scores.find((s) => s.type === type);
        expect(score?.precision).toBeGreaterThanOrEqual(0.85);
        expect(score?.recall).toBeGreaterThanOrEqual(0.9);
      }
      expect(scores).toHaveLength(3);
    },
  );
});
