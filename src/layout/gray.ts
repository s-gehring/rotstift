import type { GrayImage, RgbaImage } from './types.ts';

export const WORKING_MAX_SIDE = 1200;

export function toWorkingGray(image: RgbaImage, maxSide = WORKING_MAX_SIDE): GrayImage {
  const { width, height, data } = image;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(outWidth * outHeight);
  const sums = new Float64Array(outWidth);
  const counts = new Float64Array(outWidth);
  const columnStart = new Int32Array(outWidth + 1);
  for (let x = 0; x <= outWidth; x += 1) columnStart[x] = Math.min(width, Math.round(x / scale));

  for (let y = 0; y < outHeight; y += 1) {
    const rowStart = Math.min(height - 1, Math.round(y / scale));
    const rowEnd = Math.max(rowStart + 1, Math.min(height, Math.round((y + 1) / scale)));
    sums.fill(0);
    counts.fill(0);
    for (let sy = rowStart; sy < rowEnd; sy += 1) {
      const base = sy * width * 4;
      for (let x = 0; x < outWidth; x += 1) {
        const from = columnStart[x] ?? 0;
        const to = Math.max(from + 1, columnStart[x + 1] ?? width);
        let sum = 0;
        for (let sx = from; sx < to && sx < width; sx += 1) {
          const offset = base + sx * 4;
          const alpha = data[offset + 3] ?? 255;
          const luma =
            ((data[offset] ?? 0) * 77 +
              (data[offset + 1] ?? 0) * 150 +
              (data[offset + 2] ?? 0) * 29) >>
            8;
          sum += alpha === 255 ? luma : 255 - ((255 - luma) * alpha) / 255;
        }
        sums[x] = (sums[x] ?? 0) + sum;
        counts[x] = (counts[x] ?? 0) + Math.max(1, Math.min(to, width) - from);
      }
    }
    for (let x = 0; x < outWidth; x += 1) {
      out[y * outWidth + x] = Math.round((sums[x] ?? 0) / (counts[x] ?? 1));
    }
  }
  return { width: outWidth, height: outHeight, data: out, scale };
}
