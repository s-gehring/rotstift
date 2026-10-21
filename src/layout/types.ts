export interface BBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LineBand {
  readonly top: readonly Point[];
  readonly height: number;
}

export interface LineBox extends BBox {
  readonly band?: LineBand;
  readonly rows?: readonly LineRow[];
}

export interface LineRow extends BBox {
  readonly band?: LineBand;
  readonly from: number;
  readonly to: number;
}

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

export interface LineLocation {
  readonly bbox: LineBox;
  readonly confidence: number;
  readonly rough?: true;
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
