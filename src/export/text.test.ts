import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { encodable, fitText, formatDate, formatDecimal } from './text.ts';

async function helvetica() {
  return (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
}

describe('encodable', () => {
  it('keeps German letters and typographic quotes', async () => {
    const text = 'Äpfel, Öl und Übung: größer „so“ – ja';
    expect(encodable(await helvetica(), text)).toBe(text);
  });

  it('strips diacritics outside WinAnsi and replaces what remains', async () => {
    const font = await helvetica();
    expect(encodable(font, 'Łukasz Çağlar Đorđe Šimić')).toBe('Lukasz Çaglar Dorde Šimic');
    expect(encodable(font, 'Ли')).toBe('??');
  });

  it('collapses line breaks and tabs', async () => {
    expect(encodable(await helvetica(), 'a\n b\tc')).toBe('a b c');
  });
});

describe('fitText', () => {
  it('returns text that fits unchanged', async () => {
    expect(fitText(await helvetica(), 'Anna', 12, 200)).toBe('Anna');
  });

  it('shortens with an ellipsis to the width', async () => {
    const font = await helvetica();
    const fitted = fitText(font, 'Ein sehr langer Name, der nicht passt', 12, 80);
    expect(fitted.endsWith('…')).toBe(true);
    expect(font.widthOfTextAtSize(fitted, 12)).toBeLessThanOrEqual(80);
  });
});

describe('formatting', () => {
  it('formats dates the German way', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('05.01.2026');
  });

  it('uses a decimal comma', () => {
    expect(formatDecimal(8.333)).toBe('8,3');
    expect(formatDecimal(0)).toBe('0,0');
  });
});
