import type { DewarpPlan } from './dewarp.ts';

export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly buffer: ArrayBuffer;
}

export type DewarpRequest =
  | { readonly id: number; readonly task: 'plan'; readonly image: PixelBuffer }
  | {
      readonly id: number;
      readonly task: 'apply';
      readonly image: PixelBuffer;
      readonly plan: DewarpPlan;
    };

export type DewarpResponse =
  | { readonly id: number; readonly ok: true; readonly plan: DewarpPlan | null }
  | { readonly id: number; readonly ok: true; readonly image: PixelBuffer }
  | { readonly id: number; readonly ok: false; readonly message: string };
