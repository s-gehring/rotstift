import { expect, test, type Page } from '@playwright/test';
import {
  captureClipboard,
  copied,
  correct,
  image,
  load,
  menuItem,
  open,
  openSettings,
} from './support.ts';

async function gradingSettings(page: Page) {
  const dialog = await openSettings(page);
  await dialog.getByText('Gewichtung und Noten').click();
  return dialog;
}

function figures(page: Page) {
  return page.locator('.detail-figures');
}

test.beforeEach(async ({ page }) => {
  await captureClipboard(page);
  await open(page);
  await load(page, [image('Lena.png'), image('Tim.png')]);
  await correct(page);
});

test('weights a kind and changes only the Fehlerquotient', async ({ page }) => {
  await page.getByRole('button', { name: 'Lena', exact: true }).click();
  const shown = await figures(page).textContent();
  const before = await figures(page).getAttribute('title');
  await page.keyboard.press('Escape');

  const dialog = await gradingSettings(page);
  await dialog.getByRole('combobox', { name: 'Gewicht Rechtschreibung' }).selectOption('0');
  await expect(dialog.getByRole('button', { name: 'Zurücksetzen' })).toBeEnabled();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Lena', exact: true }).click();
  await expect(figures(page)).toHaveText(shown ?? '');
  await expect(figures(page)).not.toHaveAttribute('title', before ?? '');
});

test('shows the Note in the Arbeit, the Übersicht and the copied table', async ({ page }) => {
  const dialog = await gradingSettings(page);
  await dialog.getByRole('checkbox', { name: 'Notenschwellen' }).check();
  const first = dialog.getByRole('textbox', { name: 'Note 1 bis' });
  await first.fill('100');
  await first.blur();
  await expect(first).toHaveValue('100,0');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Lena', exact: true }).click();
  await expect(figures(page)).toContainText('Note 1');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Übersicht' }).click();
  const overview = page.getByRole('dialog', { name: 'Übersicht' });
  await expect(overview.getByRole('columnheader', { name: 'Note' })).toBeVisible();
  await expect(
    overview
      .getByRole('row', { name: /^Lena / })
      .getByRole('cell')
      .nth(3),
  ).toHaveText('1');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Exportieren' }).click();
  await menuItem(page, 'Tabelle kopieren').click();
  await expect.poll(async () => (await copied(page)).length).toBe(1);
  const [table] = await copied(page);
  expect(table?.split('\n')[0]?.split('\t')).toContain('Note');
});

test('drops the Note while the thresholds are out of order', async ({ page }) => {
  const dialog = await gradingSettings(page);
  await dialog.getByRole('checkbox', { name: 'Notenschwellen' }).check();
  await dialog.getByRole('textbox', { name: 'Note 1 bis' }).fill('100');
  const second = dialog.getByRole('textbox', { name: 'Note 2 bis' });
  await second.fill('50');
  await expect(second).toHaveAttribute('aria-invalid', 'true');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Lena', exact: true }).click();
  await expect(figures(page)).toHaveText(/^\d+ Wörter · \d+ Fehler$/u);
});
