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

async function redPixels(bytes: Uint8Array): Promise<number> {
  const image = await napi.loadImage(Buffer.from(bytes));
  const canvas = canvasModule.createCanvas(image.width, image.height);
  const context = canvasModule.get2dContext(canvas);
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (
      (data[index] ?? 0) > 150 &&
      (data[index + 1] ?? 255) < 90 &&
      (data[index + 2] ?? 255) < 90
    ) {
      count += 1;
    }
  }
  return count;
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
    expect(await redPixels(plain.bytes)).toBe(0);
    expect(await redPixels(marked.bytes)).toBeGreaterThan(1500);
  });

  it('passes a small JPEG through unchanged when nothing is marked', async () => {
    const image = await syntheticScan(page, transcript, 'jpeg');
    const source = new Uint8Array(await image.arrayBuffer());
    const encoded = await encodePageImage({ image, ...page }, DEUTSCH);
    expect(encoded.bytes).toEqual(source);
  });

  it('treats a transcript without marks like no transcript', async () => {
    const image = await syntheticScan(page, transcript, 'jpeg');
    const source = new Uint8Array(await image.arrayBuffer());
    const clean = { lines: transcript.lines.map((line) => ({ ...line, marks: [] })) };
    const encoded = await encodePageImage({ image, ...page, transcript: clean }, DEUTSCH);
    expect(encoded.bytes).toEqual(source);
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

  it('re-encodes a JPEG that exceeds the maximum edge', async () => {
    const size = { width: 300, height: 420 };
    const image = await syntheticScan(size, undefined, 'jpeg');
    const encoded = await encodePageImage({ image, ...size }, undefined, 200);
    expect(encoded.bytes).not.toEqual(new Uint8Array(await image.arrayBuffer()));
  });
});
