import { outputSize, type DewarpPlan } from '../layout/dewarp.ts';
import { sharedStraightener, type Straightener } from '../layout/dewarp-client.ts';
import type { RgbaImage } from '../layout/types.ts';
import { createCanvas, drawRotated, get2dContext, releaseCanvas } from './canvas.ts';
import { decodeScaled, readImageSize, type ImageSize } from './image-decode.ts';
import { rotatedSize, type Rotation } from './pages.ts';

export const PLAN_EDGE = 1200;

export interface Straightened {
  readonly plan: DewarpPlan;
  readonly size: ImageSize;
  readonly preview: RgbaImage;
}

function bitmapPixels(bitmap: ImageBitmap): RgbaImage {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  try {
    const context = get2dContext(canvas);
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: pixels.width, height: pixels.height, data: pixels.data };
  } finally {
    releaseCanvas(canvas);
  }
}

export function pixelsCanvas(image: RgbaImage): HTMLCanvasElement {
  const canvas = createCanvas(image.width, image.height);
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  data.set(image.data);
  get2dContext(canvas).putImageData(new ImageData(data, image.width, image.height), 0, 0);
  return canvas;
}

async function decodePixels(file: Blob, size: ImageSize, maxEdge: number): Promise<RgbaImage> {
  const bitmap = await decodeScaled(file, size, maxEdge);
  try {
    return bitmapPixels(bitmap);
  } finally {
    bitmap.close();
  }
}

export async function straightenImport(
  file: Blob,
  straightener: Straightener = sharedStraightener(),
): Promise<Straightened | null> {
  try {
    const size = await readImageSize(file);
    const pixels = await decodePixels(file, size, PLAN_EDGE);
    const plan = await straightener.plan(pixels);
    if (plan === null) return null;
    return { plan, size: outputSize(plan, size), preview: await straightener.apply(pixels, plan) };
  } catch {
    return null;
  }
}

export async function drawStraight(
  file: Blob,
  plan: DewarpPlan,
  rotation: Rotation,
  maxEdge: number,
  straightener: Straightener = sharedStraightener(),
): Promise<HTMLCanvasElement> {
  const size = await readImageSize(file);
  const target = outputSize(plan, size);
  const shrink = Math.min(1, maxEdge / Math.max(target.width, target.height));
  const sourceEdge = Math.max(1, Math.round(Math.max(size.width, size.height) * shrink));
  const straight = await straightener.apply(await decodePixels(file, size, sourceEdge), plan);
  const source = pixelsCanvas(straight);
  try {
    const turned = rotatedSize({ width: straight.width, height: straight.height, rotation });
    const canvas = createCanvas(turned.width, turned.height);
    drawRotated(get2dContext(canvas), source, canvas, straight, rotation);
    return canvas;
  } finally {
    releaseCanvas(source);
  }
}
