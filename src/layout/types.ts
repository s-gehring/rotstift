export interface BBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

export interface LineLocation {
  readonly bbox: BBox;
  readonly confidence: number;
}

export interface LayoutResult {
  readonly lines: readonly (LineLocation | null)[];
  readonly skewDegrees: number;
  readonly detectedLines: number;
}

export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly scale: number;
}
