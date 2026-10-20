import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import jpeg from 'jpeg-js';
import type { BBox, RgbaImage } from './types.ts';

export function readJpeg(path: string): RgbaImage {
  const decoded = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true });
  return { width: decoded.width, height: decoded.height, data: decoded.data };
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
