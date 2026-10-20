import { describe, expect, it } from 'vitest';
import { toWorkingGray } from './gray.ts';
import { binarize, estimateSkewTangent, removeRulesAndArtifacts, type InkMask } from './ink.ts';
import { renderPage, sampleLines } from './synthetic.ts';
import type { RgbaImage } from './types.ts';

function filled(width: number, height: number, value: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
  }
  return { width, height, data };
}

function inkCount(mask: InkMask): number {
  return mask.data.reduce((sum, value) => sum + value, 0);
}

describe('toWorkingGray', () => {
  it('keeps small images at their size and reports a scale of one', () => {
    const gray = toWorkingGray(filled(40, 30, 100));
    expect([gray.width, gray.height, gray.scale]).toEqual([40, 30, 1]);
    expect(gray.data[0]).toBe(100);
  });

  it('shrinks large images so that the longer side fits and averages the pixels', () => {
    const image = filled(2400, 1200, 200);
    const gray = toWorkingGray(image, 600);
    expect([gray.width, gray.height, gray.scale]).toEqual([600, 300, 0.25]);
    expect(gray.data[0]).toBe(200);
  });

  it('composites transparent pixels over white', () => {
    const image = filled(2, 2, 0);
    for (let i = 0; i < 4; i += 1) image.data[i * 4 + 3] = 0;
    expect(toWorkingGray(image).data[0]).toBe(255);
  });
});

describe('binarize', () => {
  it('marks dark strokes on bright paper and nothing on flat paper', () => {
    const flat = binarize(toWorkingGray(filled(100, 100, 230)));
    expect(inkCount(flat)).toBe(0);
    const image = filled(100, 100, 230);
    for (let y = 40; y < 43; y += 1) {
      for (let x = 20; x < 80; x += 1) image.data[(y * 100 + x) * 4] = 40;
    }
    const mask = binarize(toWorkingGray(image));
    expect(mask.data[41 * 100 + 50]).toBe(1);
    expect(mask.data[10 * 100 + 50]).toBe(0);
  });
});

describe('estimateSkewTangent', () => {
  it('returns zero for a straight page and the tilt for a rotated one', () => {
    const lines = sampleLines(5, 20);
    const straight = renderPage({ width: 900, height: 1200, pitch: 52, lines, seed: 1 });
    const tilted = renderPage({
      width: 900,
      height: 1200,
      pitch: 52,
      lines,
      seed: 1,
      skewDegrees: -3,
    });
    const straightTan = estimateSkewTangent(binarize(toWorkingGray(straight.image)));
    const tiltedTan = estimateSkewTangent(binarize(toWorkingGray(tilted.image)));
    expect(Math.abs(straightTan)).toBeLessThan(0.005);
    expect((Math.atan(tiltedTan) * 180) / Math.PI).toBeCloseTo(-3, 0);
  });
});

describe('removeRulesAndArtifacts', () => {
  it('removes ruling and margin lines but keeps the handwriting', () => {
    const lines = sampleLines(6, 16);
    const plain = binarize(
      toWorkingGray(renderPage({ width: 900, height: 1200, pitch: 52, lines, seed: 2 }).image),
    );
    const ruled = binarize(
      toWorkingGray(
        renderPage({
          width: 900,
          height: 1200,
          pitch: 52,
          lines,
          seed: 2,
          ruled: true,
          margin: true,
        }).image,
      ),
    );
    expect(inkCount(ruled)).toBeGreaterThan(inkCount(plain) * 1.1);
    removeRulesAndArtifacts(ruled, 0);
    removeRulesAndArtifacts(plain, 0);
    expect(inkCount(ruled)).toBeLessThan(inkCount(plain) * 1.05);
    expect(inkCount(ruled)).toBeGreaterThan(inkCount(plain) * 0.85);
  });

  it('removes scanner debris along the page border', () => {
    const image = filled(400, 500, 235);
    for (let x = 30; x < 380; x += 1) {
      for (let y = 0; y < 4; y += 1) image.data[(y * 400 + x) * 4] = 10;
    }
    for (let y = 100; y < 160; y += 1) image.data[(y * 400 + 397) * 4] = 10;
    const mask = binarize(toWorkingGray(image));
    expect(inkCount(mask)).toBeGreaterThan(0);
    removeRulesAndArtifacts(mask, 0);
    expect(inkCount(mask)).toBe(0);
  });
});
