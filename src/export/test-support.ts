import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Transcript } from '../annotations/transcript.ts';
import { FONT_FAMILY, FONT_WEIGHT } from '../overlay/model.ts';

interface NapiContext {
  fillStyle: string;
  font: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: unknown, x: number, y: number, width?: number, height?: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
  createImageData(width: number, height: number): { data: Uint8ClampedArray };
  putImageData(data: unknown, x: number, y: number): void;
}

interface NapiCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): NapiContext;
  toBuffer(type: 'image/jpeg' | 'image/png', quality?: number): Buffer;
}

interface Napi {
  createCanvas(width: number, height: number): NapiCanvas;
  loadImage(source: Buffer): Promise<{ width: number; height: number }>;
  Path2D: unknown;
  GlobalFonts: { register(data: Buffer, name: string): unknown };
}

const require = createRequire(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
export const napi: Napi = require('@napi-rs/canvas');

const overlayFontSpec = (size: number): string => `${FONT_WEIGHT} ${size}px "${FONT_FAMILY}"`;

const FONT_FILE = join(import.meta.dirname, '../overlay/fonts/Caveat-latin.woff2');

export function installCanvas(): void {
  napi.GlobalFonts.register(readFileSync(FONT_FILE), FONT_FAMILY);
  Object.assign(globalThis, {
    Path2D: napi.Path2D,
    createImageBitmap: async (blob: Blob) =>
      Object.assign(await napi.loadImage(Buffer.from(await blob.arrayBuffer())), {
        close: () => undefined,
      }),
  });
}

export const canvasModule = {
  createCanvas: (width: number, height: number) =>
    napi.createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height))),
  get2dContext: (canvas: NapiCanvas) => canvas.getContext('2d'),
  canvasToBlob: async (canvas: NapiCanvas, type: 'image/jpeg' | 'image/png', quality = 0.92) =>
    new Blob([new Uint8Array(canvas.toBuffer(type, Math.round(quality * 100)))], { type }),
  releaseCanvas: () => undefined,
};

export const fontModule = {
  overlayFontSpec,
  ensureOverlayFont: async () => undefined,
};

function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export interface ScanSize {
  readonly width: number;
  readonly height: number;
}

const scans = new Map<string, Promise<Blob>>();

export function syntheticScan(
  size: ScanSize,
  transcript: Transcript | undefined,
  format: 'png' | 'jpeg' = 'png',
): Promise<Blob> {
  const key = JSON.stringify([size, format, transcript?.lines.map((line) => line.text)]);
  let scan = scans.get(key);
  if (scan === undefined) {
    scan = drawScan(size, transcript, format);
    scans.set(key, scan);
  }
  return scan;
}

async function drawScan(
  size: ScanSize,
  transcript: Transcript | undefined,
  format: 'png' | 'jpeg' = 'png',
): Promise<Blob> {
  const canvas = napi.createCanvas(size.width, size.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f3efe4';
  context.fillRect(0, 0, size.width, size.height);
  const grain = context.getImageData(0, 0, size.width, size.height);
  const random = noise(size.width * 31 + size.height);
  const table = Array.from({ length: 65_536 }, () => Math.round((random() + random() - 1) * 14));
  for (let index = 0, step = 0; index < grain.data.length; index += 4, step += 1) {
    const shift = table[step & 0xffff] ?? 0;
    for (let channel = 0; channel < 3; channel += 1) {
      grain.data[index + channel] = (grain.data[index + channel] ?? 0) + shift;
    }
  }
  context.putImageData(grain, 0, 0);
  context.fillStyle = '#b9c7dd';
  for (let y = 200; y < size.height - 100; y += 110) context.fillRect(100, y, size.width - 200, 2);
  context.fillStyle = '#23304f';
  for (const line of transcript?.lines ?? []) {
    if (line.bbox === undefined) continue;
    context.font = overlayFontSpec(line.bbox.height * 0.95);
    context.fillText(line.text, line.bbox.x, line.bbox.y + line.bbox.height * 0.78);
  }
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  return new Blob([new Uint8Array(canvas.toBuffer(type, 90))], { type });
}

export interface PdfReadBack {
  readonly pageCount: number;
  readonly sizes: readonly (readonly [number, number])[];
  readonly texts: readonly string[];
  readonly images: readonly (readonly [number, number][])[];
  readonly title: string | undefined;
}

function titleOf(info: unknown): string | undefined {
  if (typeof info !== 'object' || info === null || !('Title' in info)) return undefined;
  return typeof info.Title === 'string' ? info.Title : undefined;
}

export async function readPdf(bytes: Uint8Array): Promise<PdfReadBack> {
  const loadingTask = getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await loadingTask.promise;
  const sizes: [number, number][] = [];
  const texts: string[] = [];
  const images: [number, number][][] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
    sizes.push([Math.round((x1 - x0) * 100) / 100, Math.round((y1 - y0) * 100) / 100]);
    const content = await page.getTextContent();
    texts.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' '),
    );
    const operators = await page.getOperatorList();
    const found: [number, number][] = [];
    operators.fnArray.forEach((fn, index) => {
      if (fn === OPS.paintImageXObject) {
        const args: unknown = operators.argsArray[index];
        if (Array.isArray(args)) found.push([Number(args[1]), Number(args[2])]);
      }
    });
    images.push(found);
  }
  const { info } = await pdf.getMetadata();
  await loadingTask.destroy();
  return { pageCount: sizes.length, sizes, texts, images, title: titleOf(info) };
}
