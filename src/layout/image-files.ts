import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import type { BBox, RgbaImage } from './types.ts';

export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (view.getUint8(offset) !== 0xff) return 1;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) return 1;
    const length = view.getUint16(offset + 2);
    const body = offset + 4;
    const isExif =
      marker === 0xe1 &&
      length >= 16 &&
      String.fromCharCode(...bytes.subarray(body, body + 4)) === 'Exif';
    if (isExif) {
      const tiff = body + 6;
      const little = view.getUint16(tiff) === 0x4949;
      const first = tiff + view.getUint32(tiff + 4, little);
      const count = view.getUint16(first, little);
      for (let entry = 0; entry < count; entry += 1) {
        const at = first + 2 + entry * 12;
        if (at + 12 > bytes.length) return 1;
        if (view.getUint16(at, little) === 0x0112) {
          const value = view.getUint16(at + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

export function applyOrientation(image: RgbaImage, orientation: number): RgbaImage {
  if (orientation === 1) return image;
  const { width, height, data } = image;
  const swap = orientation >= 5;
  const outWidth = swap ? height : width;
  const outHeight = swap ? width : height;
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let tx = x;
      let ty = y;
      switch (orientation) {
        case 2:
          tx = width - 1 - x;
          break;
        case 3:
          tx = width - 1 - x;
          ty = height - 1 - y;
          break;
        case 4:
          ty = height - 1 - y;
          break;
        case 5:
          tx = y;
          ty = x;
          break;
        case 6:
          tx = height - 1 - y;
          ty = x;
          break;
        case 7:
          tx = height - 1 - y;
          ty = width - 1 - x;
          break;
        case 8:
          tx = y;
          ty = width - 1 - x;
          break;
        default:
          break;
      }
      const from = (y * width + x) * 4;
      const to = (ty * outWidth + tx) * 4;
      out.set(data.subarray(from, from + 4), to);
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

export function readJpeg(path: string): RgbaImage {
  const bytes = readFileSync(path);
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  return applyOrientation(
    { width: decoded.width, height: decoded.height, data: decoded.data },
    jpegOrientation(bytes),
  );
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export function drawBoxes(
  image: RgbaImage,
  boxes: readonly (BBox | null)[],
  colors: readonly [number, number, number][] = [
    [220, 30, 30],
    [30, 90, 230],
  ],
): RgbaImage {
  const data = new Uint8ClampedArray(image.data);
  const { width, height } = image;
  const paint = (x: number, y: number, color: readonly [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 4;
    data[at] = color[0];
    data[at + 1] = color[1];
    data[at + 2] = color[2];
    data[at + 3] = 255;
  };
  boxes.forEach((box, index) => {
    if (box === null) return;
    const color = colors[index % colors.length] ?? [220, 30, 30];
    const x0 = Math.round(box.x);
    const y0 = Math.round(box.y);
    const x1 = Math.round(box.x + box.width) - 1;
    const y1 = Math.round(box.y + box.height) - 1;
    for (let x = x0; x <= x1; x += 1) {
      paint(x, y0, color);
      paint(x, y1, color);
    }
    for (let y = y0; y <= y1; y += 1) {
      paint(x0, y, color);
      paint(x1, y, color);
    }
  });
  return { width, height, data };
}
