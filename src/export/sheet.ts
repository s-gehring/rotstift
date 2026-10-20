import { rgb, StandardFonts, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import { INK_COLOR } from '../overlay/model.ts';
import { encodable, fitText } from './text.ts';

export const A4 = { width: 595.28, height: 841.89 } as const;
export const MARGIN = 56;

const channel = (value: string, start: number): number =>
  parseInt(value.slice(start, start + 2), 16) / 255;

const hex = (value: string) => rgb(channel(value, 1), channel(value, 3), channel(value, 5));

export const COLORS = {
  ink: hex(INK_COLOR),
  text: rgb(0.1, 0.1, 0.12),
  muted: rgb(0.42, 0.42, 0.46),
  rule: rgb(0.82, 0.82, 0.84),
  track: rgb(0.94, 0.94, 0.95),
};

export interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
}

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

export interface TextStyle {
  readonly size: number;
  readonly bold?: boolean;
  readonly color?: ReturnType<typeof rgb>;
  readonly align?: 'left' | 'right' | 'center';
  readonly maxWidth?: number;
}

export class Sheet {
  page: PDFPage;
  y = A4.height - MARGIN;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Fonts,
    private readonly onNewPage?: (sheet: Sheet) => void,
  ) {
    this.page = doc.addPage([A4.width, A4.height]);
  }

  get left(): number {
    return MARGIN;
  }

  get right(): number {
    return A4.width - MARGIN;
  }

  get width(): number {
    return A4.width - 2 * MARGIN;
  }

  get bottom(): number {
    return MARGIN;
  }

  newPage(): void {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN;
    this.onNewPage?.(this);
  }

  ensure(height: number): void {
    if (this.y - height < this.bottom) this.newPage();
  }

  measure(text: string, style: TextStyle): number {
    return this.font(style).widthOfTextAtSize(encodable(this.font(style), text), style.size);
  }

  text(text: string, x: number, baseline: number, style: TextStyle): void {
    const font = this.font(style);
    const content =
      style.maxWidth === undefined
        ? encodable(font, text)
        : fitText(font, text, style.size, style.maxWidth);
    const width = font.widthOfTextAtSize(content, style.size);
    const origin =
      style.align === 'right' ? x - width : style.align === 'center' ? x - width / 2 : x;
    this.page.drawText(content, {
      x: origin,
      y: baseline,
      size: style.size,
      font,
      color: style.color ?? COLORS.text,
    });
  }

  rule(y: number, color = COLORS.rule, thickness = 0.75): void {
    this.page.drawLine({
      start: { x: this.left, y },
      end: { x: this.right, y },
      thickness,
      color,
    });
  }

  rect(x: number, y: number, width: number, height: number, color: ReturnType<typeof rgb>): void {
    this.page.drawRectangle({ x, y, width, height, color });
  }

  private font(style: TextStyle): PDFFont {
    return style.bold === true ? this.fonts.bold : this.fonts.regular;
  }
}
