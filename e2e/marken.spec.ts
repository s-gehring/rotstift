import { expect, test } from '@playwright/test';
import { ruledPage } from './ruled-page.ts';
import { correct, load, open, summary } from './support.ts';

const PREVIEW_LINES = 5;

test('puts every mark on the line of the page it belongs to', async ({ page }) => {
  test.slow();
  const sheets = [
    ruledPage('Aufsatz-1.png', PREVIEW_LINES),
    ruledPage('Aufsatz-2.png', PREVIEW_LINES),
  ];
  await open(page);
  await load(
    page,
    sheets.map((sheet) => sheet.file),
  );
  await correct(page, sheets.length);
  await expect(summary(page)).toHaveText(/^2 Arbeiten · 2 Seiten · \d+ Wörter · \d+ Fehler$/u);

  for (const [position, entry] of sheets.entries()) {
    const name = entry.file.name.replace('.png', '');
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    const marked = page
      .locator('.sheet')
      .first()
      .locator(
        '[data-role="underline"], [data-role="ring"], [data-role="strike"], [data-role="code"]',
      );
    await expect(marked.first()).toBeAttached();
    const strokes = await marked.evaluateAll((elements) =>
      elements.flatMap((element) => {
        if (!(element instanceof SVGGraphicsElement)) return [];
        const box = element.getBBox();
        const view = element.ownerSVGElement?.viewBox.baseVal;
        const width = view?.width ?? 1;
        const height = view?.height ?? 1;
        return {
          left: box.x / width,
          right: (box.x + box.width) / width,
          top: box.y / height,
          bottom: (box.y + box.height) / height,
          middle: (box.y + box.height / 2) / height,
          line: Number(element.getAttribute('data-line')),
          role: element.getAttribute('data-role') ?? '',
        };
      }),
    );
    expect(strokes.length, `Seite ${position + 1}`).toBeGreaterThan(4);
    for (const stroke of strokes) {
      const [, top = 0, , height = 0] = entry.boxes[stroke.line - 1] ?? [];
      const below = stroke.role === 'underline' ? 0.4 : 0.1;
      const label = `${name}, ${stroke.role} auf Zeile ${stroke.line}`;
      expect(stroke.middle, label).toBeGreaterThan(top - height * 0.1);
      expect(stroke.middle, label).toBeLessThan(top + height * (1 + below));
    }
    const codes = strokes.filter((item) => item.role === 'code');
    expect(codes.length, `Randzeichen auf Seite ${position + 1}`).toBeGreaterThan(0);
    for (const stroke of codes) {
      const label = `${name}, Randzeichen auf Zeile ${stroke.line}`;
      for (const [x, y, width, height] of entry.boxes) {
        const sideways = stroke.left < (x ?? 0) + (width ?? 0) && (x ?? 0) < stroke.right;
        const vertical = stroke.top < (y ?? 0) + (height ?? 0) && (y ?? 0) < stroke.bottom;
        expect(sideways && vertical, `${label} liegt über Text`).toBe(false);
      }
      const [top, bottom] = entry.margin;
      const share = (stroke.middle - (top?.[1] ?? 0)) / ((bottom?.[1] ?? 1) - (top?.[1] ?? 0));
      const edge = (top?.[0] ?? 0) + ((bottom?.[0] ?? 0) - (top?.[0] ?? 0)) * share;
      expect(stroke.left, `${label} steht nicht im Heftrand`).toBeGreaterThan(edge);
    }
    await page.keyboard.press('Escape');
    await expect(summary(page)).toBeVisible();
  }
});
