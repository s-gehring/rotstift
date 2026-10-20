import type { RgbaImage } from './types.ts';

export async function decodeImage(image: Blob | RgbaImage): Promise<RgbaImage> {
  if (!(image instanceof Blob)) return image;
  const bitmap = await createImageBitmap(image);
  try {
    const canvas =
      typeof OffscreenCanvas === 'undefined'
        ? Object.assign(document.createElement('canvas'), {
            width: bitmap.width,
            height: bitmap.height,
          })
        : new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('2D canvas is not available');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: pixels.width, height: pixels.height, data: pixels.data };
  } finally {
    bitmap.close();
  }
}
