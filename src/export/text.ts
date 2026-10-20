import type { PDFFont } from 'pdf-lib';

const REPLACEMENTS: Readonly<Record<string, string>> = {
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ø: 'o',
  Ø: 'O',
  ı: 'i',
  ħ: 'h',
  '‑': '-',
  '−': '-',
  ' ': ' ',
};

const supported = new WeakMap<PDFFont, ReadonlySet<number>>();

function supportedCodePoints(font: PDFFont): ReadonlySet<number> {
  let set = supported.get(font);
  if (set === undefined) {
    set = new Set(font.getCharacterSet());
    supported.set(font, set);
  }
  return set;
}

function substitute(char: string, codePoints: ReadonlySet<number>): string {
  const code = char.codePointAt(0) ?? 0;
  if (codePoints.has(code)) return char;
  const replaced = REPLACEMENTS[char];
  if (replaced !== undefined) return replaced;
  const base = char.normalize('NFD').replace(/\p{M}/gu, '');
  if (base !== char && Array.from(base).every((part) => codePoints.has(part.codePointAt(0) ?? 0))) {
    return base;
  }
  return '?';
}

export function encodable(font: PDFFont, text: string): string {
  const codePoints = supportedCodePoints(font);
  return Array.from(text.replace(/\s+/gu, ' '))
    .map((char) => substitute(char, codePoints))
    .join('');
}

export function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const clean = encodable(font, text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  const chars = Array.from(clean);
  while (chars.length > 1) {
    chars.pop();
    const candidate = `${chars.join('').trimEnd()}…`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) return candidate;
  }
  return '…';
}

export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}
