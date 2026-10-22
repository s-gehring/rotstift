import { expect, test } from '@playwright/test';
import { image, load, open, pdf, summary } from './support.ts';

test.beforeEach(async ({ page }) => {
  await open(page);
});

test('shows the expected duration before and the remaining time during a run', async ({ page }) => {
  await load(page, [await pdf('Aufsatz.pdf', 2), image('Lena.png')]);
  const start = page.getByRole('button', { name: 'Korrigieren', exact: true });
  await expect(start).toHaveAttribute('title', 'etwa 2 min');

  await start.click();
  const progress = page.getByRole('banner').getByRole('status');
  await expect(progress).toHaveText(/^\d+\s%\s*noch etwa \d+ min$/u);
  await expect(page.getByRole('progressbar', { name: 'Fortschritt' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Fertig: 3 von 3 Seiten korrigiert.' }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(summary(page)).toHaveText(/^2 Arbeiten · 3 Seiten · \d+ Wörter · \d+ Fehler$/u);
});

test('cancels a run', async ({ page }) => {
  await load(page, [await pdf('Aufsatz.pdf', 2), image('Lena.png')]);
  await page.getByRole('button', { name: 'Korrigieren', exact: true }).click();
  await page.getByRole('button', { name: 'Abbrechen' }).click();

  await expect(page.getByRole('button', { name: 'Korrigieren', exact: true })).toBeEnabled();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('reports a page that failed and recognizes it again', async ({ page }) => {
  await load(page, [await pdf('Aufsatz.pdf', 4)]);
  await page.getByRole('button', { name: 'Korrigieren', exact: true }).click();

  const failure = page.getByText('Seite 4: Die Seite konnte nicht erkannt werden', {
    exact: false,
  });
  await expect(failure).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(failure).toHaveCount(0, { timeout: 20_000 });
  await expect(summary(page)).toHaveText(/^1 Arbeit · 4 Seiten · \d+ Wörter · \d+ Fehler$/u);
});
