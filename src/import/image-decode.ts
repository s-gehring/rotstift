export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export function readImageSize(file: Blob): Promise<ImageSize> {
  const url = URL.createObjectURL(file);
  return new Promise<ImageSize>((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight }),
    );
    image.addEventListener('error', () =>
      reject(new Error('Das Bild konnte nicht gelesen werden.')),
    );
    image.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

export function fitWithin(size: ImageSize, maxEdge: number): ImageSize {
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** Decodes straight to the target size so a huge photo never exists in memory at full resolution. */
export function decodeScaled(file: Blob, size: ImageSize, maxEdge: number): Promise<ImageBitmap> {
  const target = fitWithin(size, maxEdge);
  const shrink = target.width < size.width || target.height < size.height;
  return createImageBitmap(file, {
    imageOrientation: 'from-image',
    ...(shrink && {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'high',
    }),
  });
}
