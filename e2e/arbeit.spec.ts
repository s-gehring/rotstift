import { expect, test } from '@playwright/test';
import { correct, image, load, menuItem, open, pdf, summary } from './support.ts';

test.beforeEach(async ({ page }) => {
  await open(page);
  await load(page, [await pdf('Aufsatz.pdf', 2), image('Lena.png')]);
  await correct(page);
  await page.getByRole('button', { name: 'Aufsatz', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aufsatz', level: 1 })).toBeVisible();
});

test('pages through the Arbeiten with the arrow keys and switches the display', async ({
  page,
}) => {
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('heading', { name: 'Lena', level: 1 })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('heading', { name: 'Aufsatz', level: 1 })).toBeVisible();

  await page.getByRole('radio', { name: 'Original' }).click();
  await expect(page.getByRole('img', { name: 'Seite 1 von Aufsatz', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Korrigiert' }).click();
  await expect(page.getByRole('img', { name: 'Seite 1 von Aufsatz, korrigiert' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(summary(page)).toBeVisible();
});

test('jumps from the error list to the mark on the page', async ({ page }) => {
  const side = page.getByRole('complementary', { name: 'Fehler' });
  const entry = side.locator('[data-mark-key]').last();
  const key = await entry.getAttribute('data-mark-key');
  const mark = page.locator(`.annotated-page__mark[data-mark-key="${key}"]`);

  await entry.click();
  await expect(mark).toHaveClass(/is-active/u);
  await expect(mark).toBeInViewport();
});

test('edits a page with a struck word and corrects only that page again', async ({ page }) => {
  await page.getByRole('button', { name: 'Seite 1: Weitere Aktionen' }).click();
  await menuItem(page, 'Text bearbeiten').click();
  const editor = page.getByRole('textbox', { name: 'Text von Seite 1' });
  await editor.evaluate((area: HTMLTextAreaElement) => area.setSelectionRange(0, 0));
  await editor.pressSequentially('Ich ~~hab~~ habe Hunger. ');
  await expect(editor).toHaveValue(/^Ich h̶a̶b̶ habe Hunger\. Demo-Text/u);
  await page.getByRole('button', { name: 'Fertig' }).click();

  await page.getByRole('button', { name: 'Seite 1: Weitere Aktionen' }).click();
  await menuItem(page, 'Text bearbeiten').click();
  await expect(editor).toHaveValue(/^Ich h̶a̶b̶ habe Hunger\. Demo-Text/u);
  await page.getByRole('button', { name: 'Fertig' }).click();

  const errors = page
    .getByRole('complementary', { name: 'Fehler' })
    .getByRole('region', { name: 'Seite 1' });
  const fixed = errors.getByRole('button', { name: 'Rechtschreibung: „habe“ → „Habe“' });
  await expect(fixed).toHaveCount(0);
  await page.getByRole('button', { name: 'Korrigieren', exact: true }).click();
  await expect(fixed).toBeVisible({ timeout: 20_000 });
  await expect(errors.getByRole('button', { name: /„hab“/u })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Korrigieren', exact: true })).toHaveCount(0);
});
