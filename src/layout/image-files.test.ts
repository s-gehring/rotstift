import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { applyOrientation, jpegOrientation, readJpeg } from './image-files.ts';
import type { RgbaImage } from './types.ts';

function twoByThree(): RgbaImage {
  const data = new Uint8Array(2 * 3 * 4);
  for (let pixel = 0; pixel < 6; pixel += 1) {
    data.set([pixel * 40, 0, 0, 255], pixel * 4);
  }
  return { width: 2, height: 3, data };
}

function redOf(image: RgbaImage, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4] ?? -1;
}

function withOrientation(encoded: Uint8Array, orientation: number): Uint8Array {
  const tiff = new Uint8Array([
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
  const exif = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]);
  const length = exif.length + 2;
  const segment = new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...exif]);
  return new Uint8Array([...encoded.subarray(0, 2), ...segment, ...encoded.subarray(2)]);
}

describe('applyOrientation', () => {
  it('leaves orientation 1 untouched', () => {
    const image = twoByThree();
    expect(applyOrientation(image, 1)).toBe(image);
  });

  it('rotates a portrait image by 90 degrees clockwise for orientation 6', () => {
    const rotated = applyOrientation(twoByThree(), 6);
    expect(rotated.width).toBe(3);
    expect(rotated.height).toBe(2);
    expect(redOf(rotated, 2, 0)).toBe(0);
    expect(redOf(rotated, 2, 1)).toBe(40);
    expect(redOf(rotated, 0, 0)).toBe(160);
  });

  it('rotates by 180 degrees for orientation 3', () => {
    const rotated = applyOrientation(twoByThree(), 3);
    expect(rotated.width).toBe(2);
    expect(redOf(rotated, 1, 2)).toBe(0);
    expect(redOf(rotated, 0, 0)).toBe(200);
  });

  it('rotates counter-clockwise for orientation 8', () => {
    const rotated = applyOrientation(twoByThree(), 8);
    expect(rotated.width).toBe(3);
    expect(redOf(rotated, 0, 1)).toBe(0);
    expect(redOf(rotated, 2, 0)).toBe(200);
  });
});

describe('readJpeg', () => {
  const base = jpeg.encode({ ...twoByThree(), data: twoByThree().data }, 100).data;

  it('reads the orientation tag from the EXIF segment', () => {
    expect(jpegOrientation(base)).toBe(1);
    expect(jpegOrientation(withOrientation(base, 6))).toBe(6);
    expect(jpegOrientation(withOrientation(base, 8))).toBe(8);
  });

  it('returns upright pixels for an EXIF-rotated file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rotstift-jpeg-'));
    const upright = join(dir, 'upright.jpg');
    const rotated = join(dir, 'rotated.jpg');
    writeFileSync(upright, base);
    writeFileSync(rotated, withOrientation(base, 6));
    expect(readJpeg(upright).width).toBe(2);
    const image = readJpeg(rotated);
    expect(image.width).toBe(3);
    expect(image.height).toBe(2);
  });
});
