// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEUTSCH, ENGLISCH } from '../annotations/profile.ts';
import type { Transcript } from '../annotations/transcript.ts';
import { estimateTextWidth } from './char-width.ts';
import { FIXTURE_PAGE, roomyPage, tightPage, wideNoMarginPage } from './fixtures.ts';
import { layoutOverlay } from './layout.ts';
import type { TextLocator } from './locator.ts';
import type { OverlayModel, StrokeItem, TextItem } from './model.ts';

const options = { page: FIXTURE_PAGE, profile: DEUTSCH };

function strokes(model: OverlayModel): StrokeItem[] {
  return model.items.filter((item): item is StrokeItem => item.kind === 'stroke');
}

function texts(model: OverlayModel, role: TextItem['role']): TextItem[] {
  return model.items.filter((item): item is TextItem => item.kind === 'text' && item.role === role);
}

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected a value.');
  return value;
}

function roles(model: OverlayModel, lineNumber: number): StrokeItem['role'][] {
  return strokes(model)
    .filter((item) => item.line === lineNumber)
    .map((item) => item.role);
}

function pathXs(item: StrokeItem): number[] {
  const numbers = [...item.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  return numbers.filter((_, index) => index % 2 === 0);
}

function box(item: TextItem): { left: number; right: number } {
  const width = estimateTextWidth(item.text, item.size);
  const left = item.anchor === 'end' ? item.x - width : item.x;
  return { left, right: left + width };
}

function crowded(): Transcript {
  const words = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff'];
  const fixes = [
    'Anfangsbuchstabe',
    'Zwischenraum',
    'Schreibweise',
    'Rechtschreibung',
    'Gegenwart',
    'Vergangenheit',
  ];
  return {
    lines: [
      {
        number: 1,
        bbox: { x: 20, y: 200, width: 300, height: 50 },
        text: words.join(' '),
        marks: words.map((word, index) => ({
          kind: 'error' as const,
          type: 'R',
          original: word,
          correction: fixes[index] ?? '',
          offset: index * 3,
        })),
      },
    ],
  };
}

describe('layoutOverlay on a page with room', () => {
  const transcript = roomyPage();
  const model = layoutOverlay(transcript, options);

  it('is deterministic', () => {
    expect(layoutOverlay(roomyPage(), options)).toEqual(model);
  });

  it('draws one stroke per mark with the notation of its kind', () => {
    expect(roles(model, 1)).toEqual(['underline', 'underline']);
    expect(roles(model, 2)).toEqual(['caret']);
    expect(roles(model, 5)).toEqual(['strike', 'caret']);
    expect(roles(model, 6)).toEqual(['ring', 'underline', 'underline', 'underline']);
  });

  it('writes the fix above the line, not for a strike-through', () => {
    const fixes = texts(model, 'fix');
    const first = transcript.lines[0]?.bbox;
    const fix = fixes.find((item) => item.line === 1 && item.text === 'Schwimmbad');
    expect(fix).toBeDefined();
    expect(fix?.y).toBeLessThan(first?.y ?? 0);
    expect(fixes.some((item) => item.line === 5 && item.text === '')).toBe(false);
    expect(fixes.filter((item) => item.line === 5).map((item) => item.text)).toEqual(['bald']);
  });

  it('places the fix over the marked word', () => {
    const line = transcript.lines[0];
    const mark = line?.marks[1];
    const fix = texts(model, 'fix').find((item) => item.line === 1 && item.mark === 1);
    const underline = defined(strokes(model).find((item) => item.line === 1 && item.mark === 1));
    const xs = pathXs(underline);
    const underlineCenter = (Math.min(...xs) + Math.max(...xs)) / 2;
    const { left, right } = box(defined(fix));
    expect(mark?.original).toBe('Schwimbad');
    expect(Math.abs((left + right) / 2 - underlineCenter)).toBeLessThan(40);
  });

  it('writes all codes of a line in the margin column, in order', () => {
    const codes = texts(model, 'code');
    const rightOfText = Math.max(
      ...transcript.lines.map((line) => (line.bbox?.x ?? 0) + (line.bbox?.width ?? 0)),
    );
    expect(codes.map((code) => code.text)).toEqual([
      'Sb R',
      'Z',
      'G',
      'T W',
      'A W',
      'Z R R G',
      'R R R',
    ]);
    for (const code of codes) {
      expect(code.anchor).toBe('start');
      expect(code.x).toBeGreaterThan(rightOfText);
    }
    expect(new Set(codes.map((code) => code.x)).size).toBe(1);
  });

  it('keeps every text inside the page', () => {
    for (const item of texts(model, 'fix')) {
      const { left, right } = box(item);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(FIXTURE_PAGE.width);
      expect(item.y).toBeGreaterThan(0);
    }
    for (const item of texts(model, 'code')) {
      expect(box(item).right).toBeLessThanOrEqual(FIXTURE_PAGE.width);
    }
  });

  it('does not let neighbouring fixes of a line overlap', () => {
    const fixes = texts(model, 'fix');
    for (const lineNumber of transcript.lines.map((line) => line.number)) {
      const row = fixes.filter((item) => item.line === lineNumber).map(box);
      row.sort((a, b) => a.left - b.left);
      row.slice(1).forEach((current, index) => {
        expect(current.left).toBeGreaterThan(row[index]?.right ?? 0);
      });
    }
  });

  it('labels the marks with the name from the catalog', () => {
    expect(strokes(model)[0]?.title).toBe('Sb (Satzbau)');
  });
});

describe('layoutOverlay with too little space between the lines', () => {
  const model = layoutOverlay(tightPage(), options);

  it('moves the fixes into the margin next to their code', () => {
    const codes = texts(model, 'code');
    expect(codes.find((code) => code.line === 3)?.text).toBe('G: meinem');
    expect(codes.find((code) => code.line === 4)?.text).toContain('T: aßen');
  });

  it('still writes fixes above the first line, where the page top leaves room', () => {
    expect(texts(model, 'fix').map((item) => item.line)).toEqual([1, 1]);
  });

  it('uses a smaller font than on the roomy page', () => {
    const roomy = texts(layoutOverlay(roomyPage(), options), 'fix')[0]?.size ?? 0;
    const tight = texts(model, 'fix')[0]?.size ?? 0;
    expect(tight).toBeLessThan(roomy);
    expect(tight).toBeGreaterThan(0);
  });

  it('shrinks and truncates margin text that does not fit', () => {
    const code = texts(model, 'code').find((item) => item.line === 6);
    const { right } = box(defined(code));
    expect(right).toBeLessThanOrEqual(FIXTURE_PAGE.width);
    expect(code?.text.endsWith('…')).toBe(true);
  });
});

describe('layoutOverlay on a page without margin', () => {
  const transcript = wideNoMarginPage();
  const model = layoutOverlay(transcript, options);

  it('writes the codes right-aligned at the right edge of the text block', () => {
    const codes = texts(model, 'code');
    const textRight = Math.max(
      ...transcript.lines.map((line) => (line.bbox?.x ?? 0) + (line.bbox?.width ?? 0)),
    );
    expect(codes.length).toBe(7);
    for (const code of codes) {
      expect(code.anchor).toBe('end');
      expect(code.x).toBeCloseTo(textRight);
      expect(code.y).toBeLessThan(
        transcript.lines.find((line) => line.number === code.line)?.bbox?.y ?? 0,
      );
    }
  });

  it('keeps the fixes clear of the codes', () => {
    for (const code of texts(model, 'code')) {
      const codeBox = box(code);
      for (const fix of texts(model, 'fix').filter((item) => item.line === code.line)) {
        expect(box(fix).right).toBeLessThan(codeBox.left);
      }
    }
  });
});

describe('layoutOverlay edge cases', () => {
  it('resolves colliding fixes by shrinking, then by moving the widest to the margin', () => {
    const model = layoutOverlay(crowded(), { ...options, page: { width: 600, height: 400 } });
    const fixes = texts(model, 'fix');
    const boxes = fixes.map(box);
    boxes.sort((a, b) => a.left - b.left);
    boxes.slice(1).forEach((current, index) => {
      expect(current.left).toBeGreaterThan(boxes[index]?.right ?? 0);
    });
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.length).toBeLessThan(6);
    expect(texts(model, 'code')[0]?.text).toContain('R: ');
  });

  it('skips lines without a bounding box and reports them', () => {
    const transcript: Transcript = {
      lines: [
        { number: 1, text: 'Hallo', marks: [] },
        {
          number: 2,
          text: 'Wlt',
          marks: [{ kind: 'error', type: 'R', original: 'Wlt', correction: 'Welt', offset: 0 }],
        },
      ],
    };
    const model = layoutOverlay(transcript, options);
    expect(model.items).toEqual([]);
    expect(model.skippedLines).toEqual([2]);
  });

  it('draws nothing for lines without marks', () => {
    const transcript: Transcript = {
      lines: [{ number: 1, bbox: { x: 10, y: 10, width: 100, height: 30 }, text: 'ok', marks: [] }],
    };
    expect(layoutOverlay(transcript, options).items).toEqual([]);
  });

  it('shows an unknown code as written', () => {
    const transcript: Transcript = {
      lines: [
        {
          number: 1,
          bbox: { x: 150, y: 200, width: 400, height: 50 },
          text: 'Wlt',
          marks: [{ kind: 'error', type: 'Xy', original: 'Wlt', correction: 'Welt', offset: 0 }],
        },
      ],
    };
    const model = layoutOverlay(transcript, options);
    expect(texts(model, 'code')[0]?.text).toBe('Xy');
  });

  it('uses the code spelling of the catalog for the profile language', () => {
    const transcript: Transcript = {
      lines: [
        {
          number: 1,
          bbox: { x: 150, y: 200, width: 400, height: 50 },
          text: 'Wlt',
          marks: [{ kind: 'error', type: 'SB', original: 'Wlt', correction: 'Welt', offset: 0 }],
        },
      ],
    };
    expect(texts(layoutOverlay(transcript, options), 'code')[0]?.text).toBe('Sb');
    expect(
      texts(layoutOverlay(transcript, { ...options, profile: ENGLISCH }), 'code')[0]?.text,
    ).toBe('SB');
  });

  it('takes the word positions from a custom locator', () => {
    const locator: TextLocator = { span: () => ({ x0: 300, x1: 380 }) };
    const model = layoutOverlay(roomyPage(), { ...options, locator });
    const underline = defined(strokes(model).find((item) => item.role === 'underline'));
    const xs = pathXs(underline);
    expect(Math.min(...xs)).toBeGreaterThan(290);
    expect(Math.max(...xs)).toBeLessThan(390);
  });

  it('rejects an empty page', () => {
    expect(() =>
      layoutOverlay(roomyPage(), { ...options, page: { width: 0, height: 10 } }),
    ).toThrow(RangeError);
  });

  it('copes with lines overlapping each other', () => {
    const transcript: Transcript = {
      lines: [
        { number: 1, bbox: { x: 10, y: 100, width: 300, height: 50 }, text: 'ok', marks: [] },
        {
          number: 2,
          bbox: { x: 10, y: 120, width: 300, height: 50 },
          text: 'Wlt',
          marks: [{ kind: 'error', type: 'R', original: 'Wlt', correction: 'Welt', offset: 0 }],
        },
      ],
    };
    const model = layoutOverlay(transcript, options);
    expect(texts(model, 'fix')).toEqual([]);
    expect(texts(model, 'code')[0]?.text).toBe('R: Welt');
  });
});
