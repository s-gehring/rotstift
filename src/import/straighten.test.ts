// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { installCanvas, napi } from '../export/test-support.ts';
import { encodePng } from '../layout/image-files.ts';
import { cameraCorners, photograph, ruledSheet } from '../layout/synthetic-photo.ts';
import type { RgbaImage } from '../layout/types.ts';
import { canvasToBlob, createCanvas, drawRotated, get2dContext } from './canvas.ts';
import { loadImage } from './load-files.ts';
import { renderPageToPng } from './render-page.ts';

vi.mock('./canvas.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./canvas.ts')>()),
  ...(await import('../export/test-support.ts')).canvasModule,
}));

vi.mock('./image-decode.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./image-decode.ts')>();
  const support = await import('../export/test-support.ts');
  const load = async (file: Blob) => support.napi.loadImage(Buffer.from(await file.arrayBuffer()));
  return {
    ...actual,
    readImageSize: async (file: Blob) => {
      const image = await load(file);
      return { width: image.width, height: image.height };
    },
    decodeScaled: async (file: Blob, size: { width: number; height: number }, maxEdge: number) => {
      const image = await load(file);
      const target = actual.fitWithin(size, maxEdge);
      const canvas = support.napi.createCanvas(target.width, target.height);
      canvas.getContext('2d').drawImage(image, 0, 0, target.width, target.height);
      return Object.assign(canvas, { close: () => undefined });
    },
  };
});

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  installCanvas();
  vi.stubGlobal('ImageData', napi.ImageData);
});

function pngFile(image: RgbaImage, name: string): File {
  return new File([new Uint8Array(encodePng(image))], name, { type: 'image/png' });
}

async function pixels(blob: Blob): Promise<RgbaImage> {
  const image = await napi.loadImage(Buffer.from(await blob.arrayBuffer()));
  const canvas = napi.createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  return { width: image.width, height: image.height, data };
}

describe('importing images', () => {
  it('renders a scan exactly as the unstraightened image path', async () => {
    const scan = ruledSheet(0.9);
    const file = pngFile(scan, 'scan.png');
    const [page] = await loadImage(file);
    expect(page?.source).toEqual({ kind: 'image', file });
    expect([page?.width, page?.height]).toEqual([scan.width, scan.height]);
    if (page === undefined) return;
    const bitmap = await createImageBitmap(file);
    const canvas = createCanvas(scan.width, scan.height);
    drawRotated(get2dContext(canvas), bitmap, canvas, scan, 0);
    const expected = await pixels(await canvasToBlob(canvas, 'image/png'));
    const rendered = await pixels(await renderPageToPng(page));
    expect([rendered.width, rendered.height]).toEqual([scan.width, scan.height]);
    expect(Buffer.from(rendered.data).equals(Buffer.from(expected.data))).toBe(true);
  });

  it('uses the straightened page for a photographed sheet', async () => {
    const sheet = ruledSheet();
    const photo = photograph(sheet, cameraCorners(sheet.width, sheet.height), 800, 1000);
    const [page] = await loadImage(pngFile(photo, 'foto.png'));
    expect(page?.source.kind === 'image' && page.source.dewarp !== undefined).toBe(true);
    if (page === undefined) return;
    expect(page.width / page.height).toBeCloseTo(sheet.width / sheet.height, 2);
    const rendered = await pixels(await renderPageToPng(page));
    expect([rendered.width, rendered.height]).toEqual([page.width, page.height]);
  });
});
