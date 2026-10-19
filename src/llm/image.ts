export const MAX_IMAGE_EDGE = 1536;
const JPEG_QUALITY = 0.9;

export interface Size {
  width: number;
  height: number;
}

export function fitWithin(size: Size, maxEdge = MAX_IMAGE_EDGE): Size {
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('cannot read image'));
    });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('cannot read image'));
    });
    reader.readAsDataURL(blob);
  });
}

async function encodeJpeg(image: ImageBitmap, size: Size): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is not available');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  }
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is not available');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(image, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('cannot encode image'));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

export async function modelImage(source: Blob, maxEdge = MAX_IMAGE_EDGE): Promise<string> {
  const image = await createImageBitmap(source);
  try {
    return await blobDataUrl(await encodeJpeg(image, fitWithin(image, maxEdge)));
  } finally {
    image.close();
  }
}
