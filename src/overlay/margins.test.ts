// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import type { Mark, Transcript } from '../annotations/transcript.ts';
import type { Ruling } from '../layout/types.ts';
import { estimateTextWidth } from './char-width.ts';
import { layoutOverlay } from './layout.ts';
import { marginsOf, marginX } from './margins.ts';
import type { PageMargins, TextItem } from './model.ts';

const PAGE = { width: 1000, height: 700 };
const HEIGHT = 50;
const PITCH = 70;

const mark = (type: string, original: string, offset: number): Mark => ({
  kind: 'error',
  type,
  original,
  correction: 'xy',
  offset,
});

function page(textRight: number, textLeft = 150): Transcript {
  return {
    lines: [0, 1, 2, 3].map((index) => ({
      number: index + 1,
      bbox: { x: textLeft, y: 80 + index * PITCH, width: textRight - textLeft, height: HEIGHT },
      text: 'wa wb wc wd we wf',
      marks: [mark('Rechtschreibung', 'wb', 3), mark('Zeichensetzung', 'wd', 9)],
    })),
  };
}

const vertical = (x: number, tilt = 0) => [
  { x, y: 0 },
  { x: x + tilt, y: PAGE.height },
];

function codesOf(transcript: Transcript, margins?: PageMargins): TextItem[] {
  const model = layoutOverlay(transcript, {
    page: PAGE,
    profile: DEUTSCH,
    ...(margins && { margins }),
  });
  return model.items.filter(
    (item): item is TextItem => item.kind === 'text' && item.role === 'code',
  );
}

function span(item: TextItem): { left: number; right: number } {
  const width = estimateTextWidth(item.text, item.size);
  const left = item.anchor === 'end' ? item.x - width : item.x;
  return { left, right: left + width };
}

const ruling = (left: Ruling['margins']['left'], right: Ruling['margins']['right']): Ruling => ({
  kind: 'lined',
  horizontal: [],
  vertical: [],
  pitch: 40,
  columnPitch: 0,
  angleDegrees: 0,
  margins: { left, right },
});

describe('marginsOf', () => {
  it('is undefined without a ruling or without margin lines', () => {
    expect(marginsOf(undefined)).toBeUndefined();
    expect(marginsOf(ruling(null, null))).toBeUndefined();
  });

  it('keeps the points of the margin lines', () => {
    const points = vertical(800);
    expect(marginsOf(ruling(null, { points }))).toEqual({ left: null, right: points });
  });
});

describe('marginX', () => {
  it('interpolates between points and holds the ends', () => {
    const points = vertical(800, 20);
    expect(marginX(points, 0)).toBe(800);
    expect(marginX(points, PAGE.height / 2)).toBeCloseTo(810);
    expect(marginX(points, PAGE.height + 50)).toBe(820);
    expect(marginX(points, -50)).toBe(800);
  });
});

describe('error codes with a ruled margin', () => {
  it('sets the codes right of the right margin line', () => {
    const margins = { left: vertical(100), right: vertical(820) };
    const codes = codesOf(page(700), margins);
    expect(codes.length).toBeGreaterThanOrEqual(4);
    for (const code of codes) {
      expect(span(code).left).toBeGreaterThan(820);
      expect(span(code).right).toBeLessThanOrEqual(PAGE.width);
    }
  });

  it('follows a tilted margin line', () => {
    const margins = { left: null, right: vertical(800, 40) };
    for (const code of codesOf(page(700), margins)) {
      expect(span(code).left).toBeGreaterThan(marginX(margins.right, code.y));
    }
  });

  it('uses the left margin when the page has no right margin', () => {
    const margins = { left: vertical(140), right: null };
    const codes = codesOf(page(900, 160), margins);
    expect(codes.length).toBeGreaterThanOrEqual(4);
    for (const code of codes) expect(span(code).right).toBeLessThan(140);
  });

  it('moves past text that reaches into the margin instead of covering it', () => {
    const margins = { left: null, right: vertical(700) };
    const transcript = page(760);
    for (const code of codesOf(transcript, margins)) {
      for (const line of transcript.lines) {
        const bbox = line.bbox;
        if (bbox === undefined) continue;
        const overlapsText =
          span(code).left < bbox.x + bbox.width &&
          bbox.x < span(code).right &&
          code.y - code.size * 0.8 < bbox.y + bbox.height &&
          bbox.y < code.y + code.size * 0.25;
        expect(overlapsText).toBe(false);
      }
    }
  });

  it('falls back to the text-derived column when the margin leaves no room', () => {
    const margins = { left: null, right: vertical(990) };
    const without = codesOf(page(600));
    expect(codesOf(page(600), margins)).toEqual(without);
  });

  it('leaves the layout untouched without margins', () => {
    expect(codesOf(page(700))).toEqual(codesOf(page(700), undefined));
  });
});
