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

function pathPoints(item: StrokeItem): { x: number; y: number }[] {
  const numbers = [...item.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push({ x: numbers[index] ?? 0, y: numbers[index + 1] ?? 0 });
  }
  return points;
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

function marginless(): Transcript {
  return {
    lines: [0, 1].map((index) => ({
      number: index + 1,
      bbox: { x: 40, y: 100 + index * 50, width: 920, height: 50 },
      text: 'Wlt',
      marks: [
        { kind: 'error' as const, type: 'R', original: 'Wlt', correction: 'Welt', offset: 0 },
      ],
    })),
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
      'Sb  R',
      'Z',
      'G',
      'T  W',
      'A  W',
      'Z  R  R  G',
      'R  R  R',
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
    for (const item of strokes(model)) {
      for (const point of pathPoints(item)) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(FIXTURE_PAGE.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(FIXTURE_PAGE.height);
      }
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

  it('writes only the codes when the fixes do not fit into the margin', () => {
    const code = texts(model, 'code').find((item) => item.line === 6);
    expect(code?.text).toBe('Z  R  R  G');
    expect(box(defined(code)).right).toBeLessThanOrEqual(FIXTURE_PAGE.width);
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
    expect(texts(model, 'code')[0]?.text).toMatch(/^R(?: {2}R)*$/u);
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

  it('keeps strokes inside the page at its bottom and side edges', () => {
    const page = { width: 600, height: 1754 };
    const transcript: Transcript = {
      lines: [
        {
          number: 1,
          bbox: { x: 560, y: 1700, width: 40, height: 80 },
          text: 'dass',
          marks: [{ kind: 'error', type: 'R', original: 'dass', correction: 'das', offset: 0 }],
        },
        {
          number: 2,
          bbox: { x: 0, y: 1600, width: 200, height: 80 },
          text: 'Wlt ok',
          marks: [{ kind: 'error', type: 'R', original: 'Wlt', correction: '', offset: 0 }],
        },
      ],
    };
    const model = layoutOverlay(transcript, { ...options, page });
    expect(strokes(model).map((item) => item.role)).toEqual(['ring', 'strike']);
    for (const item of strokes(model)) {
      for (const point of pathPoints(item)) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(page.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(page.height);
      }
    }
  });

  it('keeps fixes clear of the codes when a fix moves to the edge text of a marginless page', () => {
    const words = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh'];
    const transcript: Transcript = {
      lines: [
        {
          number: 1,
          bbox: { x: 40, y: 200, width: 590, height: 50 },
          text: words.join(' '),
          marks: words.map((word, index) => ({
            kind: 'error' as const,
            type: 'R',
            original: word,
            correction: `Korrektur${index + 1}abc`,
            offset: index * 3,
          })),
        },
      ],
    };
    const model = layoutOverlay(transcript, { ...options, page: { width: 640, height: 400 } });
    const code = defined(texts(model, 'code')[0]);
    expect(code.anchor).toBe('end');
    expect(code.text).toContain('R: ');
    const codeBox = box(code);
    const written = texts(model, 'fix');
    expect(written.length).toBeLessThan(8);
    for (const fix of written) {
      expect(box(fix).right).toBeLessThan(codeBox.left);
    }
  });

  it('writes the codes beside the line, not over the previous one, when the strip above is too narrow', () => {
    const model = layoutOverlay(marginless(), { ...options, page: { width: 1000, height: 400 } });
    const second = defined(texts(model, 'code').find((item) => item.line === 2));
    expect(second.anchor).toBe('end');
    expect(second.x).toBeGreaterThan(960);
    expect(second.y).toBeGreaterThan(150);
    expect(box(second).left).toBeGreaterThan(960);
    expect(box(second).right).toBeLessThanOrEqual(1000);
  });

  it('limits the codes to the narrow strip when there is no room beside the line', () => {
    const transcript = marginless();
    const wide: Transcript = {
      lines: transcript.lines.map((line) => ({
        ...line,
        bbox: { x: 10, y: line.bbox?.y ?? 0, width: 980, height: 50 },
      })),
    };
    const model = layoutOverlay(wide, { ...options, page: { width: 1000, height: 400 } });
    const second = defined(texts(model, 'code').find((item) => item.line === 2));
    const roomy = texts(layoutOverlay(roomyPage(), options), 'code')[0]?.size ?? 0;
    expect(second.y).toBeLessThan(150);
    expect(second.size).toBeLessThan(roomy);
  });
});

function narrowMarginLine(number: number, y: number, types: readonly string[], fix = 'xy') {
  const words = types.map((_, index) => `w${String.fromCodePoint(97 + index)}`);
  return {
    number,
    bbox: { x: 40, y, width: 860, height: 50 },
    text: words.join(' '),
    marks: types.map((type, index) => ({
      kind: 'error' as const,
      type,
      original: words[index] ?? '',
      correction: fix,
      offset: index * 3,
    })),
  };
}

describe('layoutOverlay with a narrow margin', () => {
  const page = { width: 1000, height: 400 };
  const transcript: Transcript = {
    lines: [
      narrowMarginLine(1, 100, ['A', 'A', 'R', 'A', 'A', 'G', 'Z', 'R']),
      narrowMarginLine(2, 160, [
        'R',
        'G',
        'Z',
        'A',
        'T',
        'W',
        'R',
        'G',
        'Z',
        'A',
        'T',
        'W',
        'R',
        'G',
      ]),
      narrowMarginLine(3, 220, ['R'], 'Religionsgemeinschaften'),
    ],
  };
  const model = layoutOverlay(transcript, { ...options, page });
  const codes = texts(model, 'code');
  const rows = (line: number) =>
    codes.filter((code) => code.line === line).map((code) => code.text);

  it('keeps every code row inside the page', () => {
    expect(codes.length).toBeGreaterThan(3);
    for (const code of codes) {
      expect(box(code).left).toBeGreaterThan(900);
      expect(box(code).right).toBeLessThanOrEqual(page.width);
      expect(code.text).not.toContain('…');
    }
  });

  it('separates the codes and wraps them onto a second row', () => {
    expect(rows(1)).toEqual(['A  A  R  A', 'A  G  Z  R']);
    const [first, second] = codes.filter((code) => code.line === 1);
    expect((second?.y ?? 0) - (first?.y ?? 0)).toBeGreaterThan(0);
  });

  it('shortens the codes with a count when even two rows are too few', () => {
    const [row] = rows(2);
    expect(rows(2)).toHaveLength(1);
    expect(row).toMatch(/^R {2}G(?: {2}\S+)* {2}\+\d+$/u);
    const shown = (row ?? '').split('  ');
    expect(shown.length - 1 + Number(shown.at(-1)?.slice(1))).toBe(14);
  });

  it('writes a long fix in the margin as its code', () => {
    expect(rows(3)).toEqual(['R']);
  });
});
