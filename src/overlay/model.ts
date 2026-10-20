export interface PageSize {
  readonly width: number;
  readonly height: number;
}

export type StrokeRole = 'underline' | 'ring' | 'strike' | 'caret';
export type TextRole = 'fix' | 'code';
export type TextAnchor = 'start' | 'middle' | 'end';

export interface StrokeItem {
  readonly kind: 'stroke';
  readonly role: StrokeRole;
  readonly d: string;
  readonly width: number;
  readonly line: number;
  readonly mark: number;
  readonly title: string;
}

export interface TextItem {
  readonly kind: 'text';
  readonly role: TextRole;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly rotate: number;
  readonly anchor: TextAnchor;
  readonly line: number;
  readonly mark: number | null;
  readonly title: string;
}

export type OverlayItem = StrokeItem | TextItem;

export interface OverlayModel {
  readonly page: PageSize;
  readonly items: readonly OverlayItem[];
  readonly skippedLines: readonly number[];
}

export const INK_COLOR = '#d11f2a';
export const INK_OPACITY = 0.9;
export const FONT_FAMILY = 'Caveat';
export const FONT_WEIGHT = 500;
