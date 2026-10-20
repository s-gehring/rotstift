// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { FIXTURE_PAGE, roomyPage } from './fixtures.ts';
import { layoutOverlay } from './layout.ts';

const calls: string[] = [];

vi.mock('../import/canvas.ts', () => {
  const context = {
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => calls.push('scale'),
    stroke: () => calls.push('stroke'),
    fillText: () => calls.push('text'),
    fillRect: () => calls.push('fill'),
    drawImage: () => calls.push('image'),
  };
  return {
    createCanvas: (width: number, height: number) => {
      calls.push(`canvas ${width}x${height}`);
      return { width, height };
    },
    get2dContext: () => context,
    canvasToBlob: async (_canvas: unknown, type: string, quality?: number) => {
      calls.push(`blob ${type} ${quality}`);
      return new Blob(['bytes'], { type });
    },
    releaseCanvas: () => calls.push('release'),
  };
});

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('Path2D', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
});

function stubFonts(faces: unknown[]) {
  Object.defineProperty(document, 'fonts', {
    value: { load: async () => faces },
    configurable: true,
  });
}

describe('rasterizeAnnotatedPage', () => {
  const model = layoutOverlay(roomyPage(), { page: FIXTURE_PAGE, profile: DEUTSCH });

  it('draws the page image first, then the marks, and returns a PNG', async () => {
    stubFonts([{}]);
    const { rasterizeAnnotatedPage } = await import('./draw-canvas.ts');
    const blob = await rasterizeAnnotatedPage({ image: document.createElement('canvas'), model });
    expect(blob.type).toBe('image/png');
    expect(calls[0]).toBe('canvas 1240x1754');
    expect(calls.indexOf('image')).toBeLessThan(calls.indexOf('stroke'));
    expect(calls.filter((call) => call === 'text').length).toBeGreaterThan(0);
    expect(calls.at(-1)).toBe('release');
  });

  it('shrinks to the maximum edge and returns a JPEG on a white ground', async () => {
    stubFonts([{}]);
    const { rasterizeAnnotatedPage } = await import('./draw-canvas.ts');
    const blob = await rasterizeAnnotatedPage({
      image: document.createElement('canvas'),
      model,
      type: 'image/jpeg',
      quality: 0.8,
      maxEdge: 877,
    });
    expect(blob.type).toBe('image/jpeg');
    expect(calls[0]).toBe('canvas 620x877');
    expect(calls.indexOf('fill')).toBeLessThan(calls.indexOf('image'));
    expect(calls).toContain('blob image/jpeg 0.8');
  });

  it('does not wait for the handwriting font when there is nothing to draw', async () => {
    stubFonts([]);
    const { rasterizeAnnotatedPage } = await import('./draw-canvas.ts');
    const empty = { page: model.page, items: [], skippedLines: [] };
    const blob = await rasterizeAnnotatedPage({
      image: document.createElement('canvas'),
      model: empty,
    });
    expect(blob.type).toBe('image/png');
  });

  it('refuses to draw in a fallback font when the handwriting font is missing', async () => {
    stubFonts([]);
    const { rasterizeAnnotatedPage } = await import('./draw-canvas.ts');
    await expect(
      rasterizeAnnotatedPage({ image: document.createElement('canvas'), model }),
    ).rejects.toThrow('Schrift');
    expect(calls).toEqual([]);
  });
});
