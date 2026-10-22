import { expect, test, type Page } from '@playwright/test';
import { correct, image, load, open, summary } from './support.ts';

const ASSIGNMENT = 'Schreibe deinem Freund einen Brief, in dem du von deinem Umzug erzählst.';

function subject(page: Page) {
  return page.getByRole('button', { name: /^Deutsch/u });
}

function kind(page: Page, name: string) {
  return page.getByRole('checkbox', { name });
}

test.beforeEach(async ({ page }) => {
  await open(page);
  await load(page, [image('Lena.png')]);
});

test('chooses the kinds, locks the last one and closes with Escape', async ({ page }) => {
  await subject(page).click();
  await expect(kind(page, 'Rechtschreibung')).toBeChecked();
  await expect(kind(page, 'Grammatik')).toBeChecked();
  await expect(kind(page, 'Inhalt')).not.toBeChecked();
  await expect(kind(page, 'Form')).not.toBeChecked();

  await kind(page, 'Rechtschreibung').uncheck();
  await expect(kind(page, 'Grammatik')).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(kind(page, 'Grammatik')).toHaveCount(0);
  await expect(subject(page)).toBeFocused();
});

test('marks the button while an Aufgabenstellung is set and closes on a click outside', async ({
  page,
}) => {
  await subject(page).click();
  await page.getByRole('textbox', { name: 'Aufgabenstellung' }).fill(ASSIGNMENT);
  await page.getByRole('main').click({ position: { x: 20, y: 300 } });

  await expect(kind(page, 'Inhalt')).toHaveCount(0);
  await expect(subject(page)).toHaveAccessibleName(/^Deutsch\s*, mit Aufgabenstellung$/u);
  await expect(subject(page)).toHaveAttribute('title', 'Mit Aufgabenstellung');
});

test('counts only the requested kinds', async ({ page }) => {
  await subject(page).click();
  await kind(page, 'Rechtschreibung').uncheck();
  await page.keyboard.press('Escape');
  await correct(page);

  await expect(summary(page)).toHaveText(/^1 Arbeit · 1 Seite · \d+ Wörter · 0 Fehler$/u);
});

test('names every missing field and focuses the first', async ({ page }) => {
  await subject(page).click();
  await kind(page, 'Inhalt').check();
  await kind(page, 'Form').check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Korrigieren', exact: true }).click();

  const form = page.getByRole('combobox', { name: 'Textform' });
  const assignment = page.getByRole('textbox', { name: 'Aufgabenstellung' });
  await expect(form).toBeFocused();
  await expect(form).toHaveAttribute('aria-invalid', 'true');
  await expect(form).toHaveAccessibleDescription('Textform fehlt');
  await expect(assignment).toHaveAttribute('aria-invalid', 'true');
  await expect(assignment).toHaveAccessibleDescription('Aufgabenstellung fehlt');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('reviews Inhalt und Form and discards a comment without changing the errors', async ({
  page,
}) => {
  await subject(page).click();
  await kind(page, 'Inhalt').check();
  await kind(page, 'Form').check();
  await page.getByRole('combobox', { name: 'Textform' }).fill('Brief an einen Freund');
  await page.getByRole('textbox', { name: 'Aufgabenstellung' }).fill(ASSIGNMENT);
  await page.keyboard.press('Escape');
  await correct(page);

  await page.getByRole('button', { name: 'Lena', exact: true }).click();
  const counts = page.getByText(/^\d+ Wörter · \d+ Fehler$/u);
  const before = await counts.textContent();
  const review = page.getByRole('region', { name: 'Inhalt und Form' });
  const comments = review.getByRole('button', { name: /^Verwerfen: /u });
  await expect(comments).toHaveCount(2);
  const closing = review.getByText(/^(Inhalt|Form): /u);
  await expect(closing).toBeVisible();

  const name = await comments.first().getAttribute('aria-label');
  const text = (name ?? '').replace('Verwerfen: ', '');
  await expect(page.getByRole('img', { name: 'Korrekturen' }).first()).toContainText(
    text.split(' ')[0] ?? '',
  );
  await comments.first().click();
  await expect(review.getByRole('button', { name: `Rückgängig: ${text}` })).toBeVisible();
  await expect(closing).not.toContainText(text);
  await expect(counts).toHaveText(before ?? '');

  await review.getByRole('button', { name: `Rückgängig: ${text}` }).click();
  await expect(comments).toHaveCount(2);
  await expect(closing).toContainText(text);
});
