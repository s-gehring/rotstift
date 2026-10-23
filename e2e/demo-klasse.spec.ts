import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { correct, menuItem, open, summary } from './support.ts';

interface DemoPage {
  readonly arbeit: string;
  readonly lines: readonly string[];
  readonly boxes: readonly (readonly number[])[];
  readonly margin: readonly (readonly number[])[] | null;
}

const pages: DemoPage[] = JSON.parse(
  readFileSync(new URL('../src/pipeline/demo-class/pages.json', import.meta.url), 'utf8'),
);

test.beforeEach(async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Demo-Klasse laden' }).click();
  await expect(summary(page)).toHaveText('4 Arbeiten · 5 Seiten');
});

test('adds the demo class again from the menu', async ({ page }) => {
  await page.getByRole('button', { name: 'Weitere Aktionen für die Klasse' }).click();
  await menuItem(page, 'Demo-Klasse hinzufügen').click();
  await expect(summary(page)).toHaveText('8 Arbeiten · 10 Seiten');
});

test('puts every mark on the line of the page it belongs to', async ({ page }) => {
  test.slow();
  await correct(page, pages.length);
  await expect(summary(page)).toHaveText(/^4 Arbeiten · 5 Seiten · \d+ Wörter · \d+ Fehler$/u);

  const names = [...new Set(pages.map((entry) => entry.arbeit))];
  for (const name of names) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    const sheets = page.locator('.sheet');
    const expected = pages.filter((entry) => entry.arbeit === name);
    await expect(sheets).toHaveCount(expected.length);
    for (const [index, entry] of expected.entries()) {
      const marked = sheets
        .nth(index)
        .locator(
          '[data-role="underline"], [data-role="ring"], [data-role="strike"], [data-role="code"]',
        );
      await expect(marked.first()).toBeAttached();
      const strokes = await marked.evaluateAll((elements) =>
        elements.flatMap((element) => {
          if (!(element instanceof SVGGraphicsElement)) return [];
          const box = element.getBBox();
          const view = element.ownerSVGElement?.viewBox.baseVal;
          return {
            left: box.x / (view?.width ?? 1),
            right: (box.x + box.width) / (view?.width ?? 1),
            top: box.y / (view?.height ?? 1),
            bottom: (box.y + box.height) / (view?.height ?? 1),
            line: Number(element.getAttribute('data-line')),
            role: element.getAttribute('data-role') ?? '',
            middle:
              (box.y + box.height / 2) / (element.ownerSVGElement?.viewBox.baseVal.height ?? 1),
          };
        }),
      );
      expect(strokes.length).toBeGreaterThan(4);
      for (const stroke of strokes) {
        const [, top = 0, , height = 0] = entry.boxes[stroke.line - 1] ?? [];
        const below = stroke.role === 'underline' ? 0.4 : 0.1;
        const label = `${name}, ${stroke.role} auf Zeile ${stroke.line}`;
        expect(stroke.middle, label).toBeGreaterThan(top - height * 0.1);
        expect(stroke.middle, label).toBeLessThan(top + height * (1 + below));
      }
      for (const stroke of strokes.filter((item) => item.role === 'code')) {
        const label = `${name}, Randzeichen auf Zeile ${stroke.line}`;
        for (const [x, y, width, height] of entry.boxes) {
          const sideways = stroke.left < (x ?? 0) + (width ?? 0) && (x ?? 0) < stroke.right;
          const vertical = stroke.top < (y ?? 0) + (height ?? 0) && (y ?? 0) < stroke.bottom;
          expect(sideways && vertical, `${label} liegt über Text`).toBe(false);
        }
        const [top, bottom] = entry.margin ?? [];
        if (top === undefined || bottom === undefined) continue;
        const share = (stroke.middle - (top[1] ?? 0)) / ((bottom[1] ?? 1) - (top[1] ?? 0));
        const edge = (top[0] ?? 0) + ((bottom[0] ?? 0) - (top[0] ?? 0)) * share;
        expect(stroke.left, `${label} steht nicht im Heftrand`).toBeGreaterThan(edge);
      }
    }
    await page.keyboard.press('Escape');
    await expect(summary(page)).toBeVisible();
  }
});
