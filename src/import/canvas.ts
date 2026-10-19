export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) reject(new Error('Das Bild konnte nicht erzeugt werden.'));
        else resolve(blob);
      },
      type,
      quality,
    );
  });
}

export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Zeichenfläche nicht verfügbar.');
  return context;
}

export type DrawingContext = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'fillRect' | 'translate' | 'rotate' | 'drawImage' | 'imageSmoothingQuality'
>;

export function drawRotated(
  context: DrawingContext,
  image: CanvasImageSource,
  canvas: { readonly width: number; readonly height: number },
  imageSize: { readonly width: number; readonly height: number },
  rotationDegrees: number,
): void {
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotationDegrees * Math.PI) / 180);
  context.drawImage(
    image,
    -imageSize.width / 2,
    -imageSize.height / 2,
    imageSize.width,
    imageSize.height,
  );
}
