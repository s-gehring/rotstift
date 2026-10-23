import { createCanvas } from '@napi-rs/canvas';
import type { UploadFile } from './support.ts';

const WIDTH = 1000;
const HEIGHT = 1414;
const PITCH = 52;
const FIRST_RULE = 200;
const MARGIN_X = 800;
const TEXT_X = 100;

export interface RuledPage {
  readonly file: UploadFile;
  readonly lines: number;
  readonly boxes: readonly (readonly number[])[];
  readonly margin: readonly (readonly number[])[];
}

export function ruledPage(name: string, lines: number): RuledPage {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f7f6f0';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = '#9db7d8';
  context.lineWidth = 2;
  for (let y = FIRST_RULE - 2 * PITCH; y < HEIGHT - 40; y += PITCH) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WIDTH, y);
    context.stroke();
  }
  context.strokeStyle = '#d9776f';
  for (const x of [MARGIN_X, MARGIN_X + 5]) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, HEIGHT);
    context.stroke();
  }

  context.fillStyle = '#1c2873';
  context.font = '34px sans-serif';
  const boxes: number[][] = [];
  for (let line = 0; line < lines; line += 1) {
    const text = `Platzhalter dieser Zeile ${line + 1}`;
    const baseline = FIRST_RULE + line * PITCH - 10;
    const metrics = context.measureText(text);
    context.fillText(text, TEXT_X, baseline);
    boxes.push([
      TEXT_X / WIDTH,
      (baseline - metrics.actualBoundingBoxAscent) / HEIGHT,
      metrics.width / WIDTH,
      (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) / HEIGHT,
    ]);
  }
  return {
    file: { name, mimeType: 'image/png', buffer: canvas.toBuffer('image/png') },
    lines,
    boxes,
    margin: [
      [MARGIN_X / WIDTH, 0],
      [MARGIN_X / WIDTH, 1],
    ],
  };
}
