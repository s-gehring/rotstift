// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEUTSCH } from '../annotations/profile.ts';
import { FIXTURE_PAGE, roomyPage } from '../overlay/fixtures.ts';
import { encodePageImage } from './page-image.ts';
import { canvasModule, installCanvas, napi, syntheticScan } from './test-support.ts';

vi.mock('../import/canvas.ts', () => import('./test-support.ts').then((m) => m.canvasModule));
vi.mock('../overlay/font.ts', () => import('./test-support.ts').then((m) => m.fontModule));

vi.setConfig({ testTimeout: 30_000 });

beforeAll(installCanvas);

interface RedBounds {
  readonly count: number;
  readonly minY: number;
  readonly maxY: number;
}

async function redBounds(bytes: Uint8Array): Promise<RedBounds> {
  const image = await napi.loadImage(Buffer.from(bytes));
  const canvas = canvasModule.createCanvas(image.width, image.height);
  const context = canvasModule.get2dContext(canvas);
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let count = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < data.length; index += 4) {
    if (
      (data[index] ?? 0) > 150 &&
      (data[index + 1] ?? 255) < 90 &&
      (data[index + 2] ?? 255) < 90
    ) {
      const y = Math.floor(index / 4 / image.width);
      count += 1;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { count, minY, maxY };
}

const transcript = roomyPage();
const page = { ...FIXTURE_PAGE };

describe('encodePageImage', () => {
  it('draws the red marks into the page', async () => {
    const image = await syntheticScan(page, transcript);
    const plain = await encodePageImage({ image, ...page }, undefined);
    const marked = await encodePageImage({ image, ...page, transcript }, DEUTSCH);
    expect(plain.format).toBe('jpeg');
    expect(marked.format).toBe('jpeg');
    expect((await redBounds(plain.bytes)).count).toBe(0);
    expect((await redBounds(marked.bytes)).count).toBeGreaterThan(1500);
  });

  it('draws the marks of a line next to that line', async () => {
    const third = transcript.lines[2];
    if (third?.bbox === undefined) throw new Error('missing line');
    const onlyThird = {
      lines: transcript.lines.map((line) => (line === third ? line : { ...line, marks: [] })),
    };
    const image = await syntheticScan(page, transcript);
    const encoded = await encodePageImage({ image, ...page, transcript: onlyThird }, DEUTSCH);
    const red = await redBounds(encoded.bytes);
    expect(red.count).toBeGreaterThan(200);
    expect(red.minY).toBeGreaterThan(third.bbox.y - 110);
    expect(red.maxY).toBeLessThan(third.bbox.y + third.bbox.height + 40);
  });

  it('treats a transcript without marks like no transcript', async () => {
    const image = await syntheticScan(page, transcript);
    const clean = { lines: transcript.lines.map((line) => ({ ...line, marks: [] })) };
    const encoded = await encodePageImage({ image, ...page, transcript: clean }, DEUTSCH);
    expect((await redBounds(encoded.bytes)).count).toBe(0);
  });

  it('converts a PNG scan to a much smaller JPEG', async () => {
    const image = await syntheticScan(page, transcript);
    const encoded = await encodePageImage({ image, ...page }, undefined);
    expect(encoded.bytes.length).toBeLessThan(image.size / 3);
  });

  it('shrinks pages larger than the maximum edge', async () => {
    const size = { width: 300, height: 420 };
    const image = await syntheticScan(size, undefined);
    const encoded = await encodePageImage({ image, ...size }, undefined, 200);
    const decoded = await napi.loadImage(Buffer.from(encoded.bytes));
    expect(decoded.height).toBe(200);
    expect(decoded.width / decoded.height).toBeCloseTo(size.width / size.height, 1);
  });

  it('refuses page dimensions that do not match the image, for example of a rotated page', async () => {
    const image = await syntheticScan(page, transcript);
    const swapped = { width: page.height, height: page.width };
    await expect(encodePageImage({ image, ...swapped, transcript }, DEUTSCH)).rejects.toThrow(
      'passen nicht zum Bild',
    );
  });
});
