// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { drawOverlay, type OverlayContext } from './draw-canvas.ts';
import { FIXTURE_PAGE, roomyPage } from './fixtures.ts';
import { layoutOverlay } from './layout.ts';
import { INK_COLOR } from './model.ts';

class FakePath2D {
  constructor(readonly d: string) {}
}

function recordingContext() {
  const calls: string[] = [];
  const context: OverlayContext = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: (x, y) => calls.push(`translate ${x.toFixed(0)} ${y.toFixed(0)}`),
    rotate: () => calls.push('rotate'),
    stroke: () => calls.push('stroke'),
    fillText: (text) => calls.push(`text ${text}|${context.textAlign}|${context.font}`),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  return { context, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('drawOverlay', () => {
  it('strokes every path and writes every text in the ink colour', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    const model = layoutOverlay(roomyPage(), { page: FIXTURE_PAGE, profile: DEUTSCH });
    const { context, calls } = recordingContext();

    drawOverlay(context, model);

    const strokes = model.items.filter((item) => item.kind === 'stroke').length;
    const texts = model.items.filter((item) => item.kind === 'text');
    expect(calls.filter((call) => call === 'stroke').length).toBe(strokes);
    expect(
      calls.filter((call) => call.startsWith('text ')).map((call) => call.slice(5).split('|')[0]),
    ).toEqual(texts.map((item) => item.text));
    expect(calls.filter((call) => call === 'save').length).toBe(
      calls.filter((c) => c === 'restore').length,
    );
    expect(context.strokeStyle).toBe(INK_COLOR);
    expect(context.fillStyle).toBe(INK_COLOR);
    expect(context.lineCap).toBe('round');
  });

  it('aligns the text by its anchor and sets the handwriting font', () => {
    vi.stubGlobal('Path2D', FakePath2D);
    const { context, calls } = recordingContext();
    const item = {
      kind: 'text',
      role: 'code',
      text: 'R',
      x: 100,
      y: 50,
      size: 20,
      rotate: 0,
      line: 1,
      mark: null,
      title: 'R',
    } as const;
    drawOverlay(context, {
      page: FIXTURE_PAGE,
      skippedLines: [],
      items: [
        { ...item, text: 'A', anchor: 'start' },
        { ...item, text: 'B', anchor: 'middle' },
        { ...item, text: 'C', anchor: 'end' },
      ],
    });
    const written = calls.filter((call) => call.startsWith('text '));
    expect(written).toEqual([
      'text A|left|500 20px "Caveat"',
      'text B|center|500 20px "Caveat"',
      'text C|right|500 20px "Caveat"',
    ]);
  });
});
