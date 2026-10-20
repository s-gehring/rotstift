import type { LayoutResult, RgbaImage } from './types.ts';

export type LayoutImage =
  | { readonly kind: 'blob'; readonly blob: Blob }
  | {
      readonly kind: 'pixels';
      readonly width: number;
      readonly height: number;
      readonly buffer: ArrayBuffer;
    };

export interface LayoutRequest {
  readonly id: number;
  readonly image: LayoutImage;
  readonly lines: readonly string[];
}

export type LayoutResponse =
  | { readonly id: number; readonly ok: true; readonly result: LayoutResult }
  | { readonly id: number; readonly ok: false; readonly message: string };

export type LayoutInput = Blob | RgbaImage;
