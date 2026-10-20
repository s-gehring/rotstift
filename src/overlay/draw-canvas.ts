import { canvasToBlob, createCanvas, get2dContext, releaseCanvas } from '../import/canvas.ts';
import { ensureOverlayFont, overlayFontSpec } from './font.ts';
import { INK_COLOR, INK_OPACITY, type OverlayModel } from './model.ts';

export type OverlayContext = Pick<
  CanvasRenderingContext2D,
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'globalAlpha'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
> & {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  stroke(path: Path2D): void;
  fillText(text: string, x: number, y: number): void;
};

export function drawOverlay(context: OverlayContext, model: OverlayModel): void {
  context.save();
  context.strokeStyle = INK_COLOR;
  context.fillStyle = INK_COLOR;
  context.globalAlpha = INK_OPACITY;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.textBaseline = 'alphabetic';
  for (const item of model.items) {
    if (item.kind === 'stroke') {
      context.lineWidth = item.width;
      context.stroke(new Path2D(item.d));
    } else {
      context.save();
      context.translate(item.x, item.y);
      context.rotate((item.rotate * Math.PI) / 180);
      context.font = overlayFontSpec(item.size);
      context.textAlign =
        item.anchor === 'middle' ? 'center' : item.anchor === 'end' ? 'right' : 'left';
      context.fillText(item.text, 0, 0);
      context.restore();
    }
  }
  context.restore();
}

export interface RasterizeInput {
  readonly image: CanvasImageSource;
  readonly model: OverlayModel;
}

export async function rasterizeAnnotatedPage({ image, model }: RasterizeInput): Promise<Blob> {
  await ensureOverlayFont();
  const canvas = createCanvas(model.page.width, model.page.height);
  try {
    const context = get2dContext(canvas);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.scale(canvas.width / model.page.width, canvas.height / model.page.height);
    drawOverlay(context, model);
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    releaseCanvas(canvas);
  }
}
