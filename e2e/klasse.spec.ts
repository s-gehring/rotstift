import { expect, test } from '@playwright/test';
import { image, load, menuItem, open, pdf, summary } from './support.ts';

test.beforeEach(async ({ page }) => {
  await open(page);
});

test('loads a PDF and two images as three Arbeiten', async ({ page }) => {
  await load(page, [await pdf('Aufsatz.pdf', 2), image('Lena.png'), image('Tim.png')]);

  await expect(summary(page)).toHaveText('3 Arbeiten · 4 Seiten');
  const pages = page.getByRole('list', { name: 'Seiten von Aufsatz' }).getByRole('listitem');
  await expect(pages).toHaveCount(2);
  await expect(page.getByRole('list', { name: 'Seiten von Lena' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Seiten von Tim' })).toBeVisible();
});

test('rotates and moves a page, removes an Arbeit and brings it back', async ({ page }) => {
  await load(page, [await pdf('Aufsatz.pdf', 2), image('Lena.png')]);
  await expect(summary(page)).toHaveText('2 Arbeiten · 3 Seiten');

  const first = page.getByRole('button', { name: 'Seite 1 von Aufsatz vergrößern' }).locator('img');
  await expect(first).toHaveAttribute('style', /rotate\(0deg\)/u);
  await page.getByRole('button', { name: 'Seite 1 von Aufsatz drehen' }).click();
  await expect(first).toHaveAttribute('style', /rotate\(90deg\)/u);

  await page.getByRole('button', { name: 'Weitere Aktionen für Seite 1 von Aufsatz' }).click();
  await menuItem(page, 'In andere Arbeit').click();
  await menuItem(page, 'Lena').click();
  await expect(
    page.getByRole('list', { name: 'Seiten von Lena' }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(
    page.getByRole('list', { name: 'Seiten von Aufsatz' }).getByRole('listitem'),
  ).toHaveCount(1);

  await page.getByRole('button', { name: 'Weitere Aktionen für Aufsatz' }).click();
  await menuItem(page, 'Entfernen').click();
  await expect(summary(page)).toHaveText('1 Arbeit · 2 Seiten');
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(summary(page)).toHaveText('2 Arbeiten · 3 Seiten');
});

test('counts words without the correction model', async ({ page }) => {
  await load(page, [image('Lena.png'), image('Tim.png')]);
  await page.getByRole('button', { name: 'Weitere Möglichkeiten' }).click();
  await menuItem(page, 'Nur Wörter zählen').click();

  await expect(summary(page)).toHaveText(/^2 Arbeiten · 2 Seiten · \d+ Wörter$/u, {
    timeout: 15_000,
  });
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Lena' })
      .getByText(/^\d+ Wörter$/u),
  ).toBeVisible();
  await expect(page.getByText(/Fehler/u)).toHaveCount(0);
});

test('works the page menu with the keyboard', async ({ page }) => {
  await load(page, [await pdf('Aufsatz.pdf', 2), image('Lena.png')]);
  const trigger = page.getByRole('button', { name: 'Weitere Aktionen für Seite 1 von Aufsatz' });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  const items = page.getByRole('menu').first().getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();

  await menuItem(page, 'In andere Arbeit').focus();
  await page.keyboard.press('ArrowRight');
  await expect(menuItem(page, 'Lena')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(menuItem(page, 'Lena')).toHaveCount(0);
  await expect(menuItem(page, 'In andere Arbeit')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
