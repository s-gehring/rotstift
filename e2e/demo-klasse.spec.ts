import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { correct, menuItem, open, summary } from './support.ts';

interface DemoPage {
  readonly arbeit: string;
  readonly lines: readonly string[];
  readonly boxes: readonly (readonly number[])[];
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
          return {
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
    }
    await page.keyboard.press('Escape');
    await expect(summary(page)).toBeVisible();
  }
});
