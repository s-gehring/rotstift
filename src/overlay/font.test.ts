// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureOverlayFont, overlayFontSpec } from './font.ts';

function stubFonts(load: (spec: string, text: string) => Promise<unknown[]>) {
  Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'fonts');
});

describe('ensureOverlayFont', () => {
  it('loads the handwriting font with umlauts', async () => {
    const load = vi.fn<(spec: string, text: string) => Promise<unknown[]>>(async () => [{}]);
    stubFonts(load);
    await ensureOverlayFont();
    expect(load).toHaveBeenCalledWith(overlayFontSpec(32), 'ÄÖÜäöüß');
  });

  it('fails with a German message when the font is not available', async () => {
    stubFonts(async () => []);
    await expect(ensureOverlayFont()).rejects.toThrow(
      'Die Schrift für die Korrekturen konnte nicht geladen werden.',
    );
  });
});
