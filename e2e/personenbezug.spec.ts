import { expect, test, type Page } from '@playwright/test';
import { ruledPage } from './ruled-page.ts';
import { load, open, openSettings } from './support.ts';
import { cloudViolations, mockTauri, tauriCalls } from './tauri.ts';

const TRANSCRIPT = [
  'Ich heiße Lena Schmidt.',
  'Lena war im Schwimbad.',
  'Mein Freund Jonas kam mit.',
  'Danach fuhren wir nach Wolfhagen.',
];

const FORBIDDEN = ['Lena', 'Schmidt', 'Jonas', 'Wolfhagen'];

async function useCloudCorrection(page: Page) {
  const settings = await openSettings(page);
  const correction = settings.getByRole('region', { name: 'Korrektur' });
  await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
  await correction.getByRole('combobox', { name: 'Anbieter' }).selectOption('mistral');
  await correction.getByLabel('Schlüssel').fill('fake-test-key');
  await correction.getByRole('textbox', { name: 'Modell' }).fill('mistral-small-latest');
  await correction.getByRole('button', { name: 'Verwenden' }).click();
  await correction.getByRole('alertdialog').getByRole('button', { name: 'Verwenden' }).click();
  await expect(
    correction.getByRole('radio', { name: /^mistral-small-latest Cloud/u }),
  ).toBeChecked();
  await page.keyboard.press('Escape');
}

test('checks a protected cloud correction before sending and draws its marks', async ({ page }) => {
  test.slow();
  await mockTauri(page, {
    totalRamGiB: 16,
    transcript: TRANSCRIPT,
    cloudChat: { forbidden: FORBIDDEN, fix: ['Schwimbad', 'Schwimmbad'] },
    privacyAnswer: '{"kennungen":[{"zitat":"Wolfhagen","kategorie":"Ort"}],"sensibel":[]}',
  });
  await open(page);
  await useCloudCorrection(page);

  const sheet = ruledPage('Lena Schmidt.png', TRANSCRIPT.length, TRANSCRIPT);
  await load(page, [sheet.file]);
  await page.getByRole('button', { name: 'Korrigieren', exact: true }).click();

  const review = page.getByRole('dialog', { name: 'Vor dem Senden prüfen' });
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(review).toContainText('pseudonymisiert');
  await expect(review).not.toContainText(/anonym/iu);
  await expect(review.getByRole('button', { name: /^Lena Schmidt\s*zu prüfen$/u })).toBeVisible();
  await expect(review).toContainText('Lena Schmidt [Person 1]');
  await expect(review).toContainText(/Jonas \[Person \d\]/u);
  await expect(review).toContainText('Wolfhagen [Ort 1]');
  expect(await tauriCalls(page, 'cloud_chat')).toEqual([]);

  await review.getByRole('button', { name: 'Freigeben' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Fertig: / })).toBeVisible({
    timeout: 20_000,
  });

  const requests = await tauriCalls(page, 'cloud_chat');
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.args['pseudonymized']).toBe(true);
    const sent = JSON.stringify(request.args['request']);
    for (const name of FORBIDDEN) expect(sent).not.toContain(name);
    expect(sent).toContain('[Person 1]');
  }
  expect(await cloudViolations(page)).toEqual([]);

  await page.getByRole('button', { name: 'Lena Schmidt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lena Schmidt', level: 1 })).toBeVisible();
  const marks = page
    .locator('.sheet')
    .first()
    .locator('[data-role="underline"], [data-role="code"]');
  await expect(marks.first()).toBeAttached();
  await expect(page.locator('main')).toContainText('Schwimmbad');
});

test('asks for the local model instead of sending when it is missing', async ({ page }) => {
  await mockTauri(page, {
    totalRamGiB: 16,
    transcript: TRANSCRIPT,
    cloudChat: { forbidden: FORBIDDEN, fix: ['Schwimbad', 'Schwimmbad'] },
    missing: ['gemma-4-e2b-q4'],
  });
  await open(page);
  await useCloudCorrection(page);

  await load(page, [ruledPage('Lena Schmidt.png', TRANSCRIPT.length, TRANSCRIPT).file]);
  await page.getByRole('button', { name: 'Korrigieren', exact: true }).click();

  const work = page.getByRole('listitem').filter({ hasText: 'Lena Schmidt' });
  await expect(work).toContainText('Gemma 4 E2B', { timeout: 20_000 });
  await expect(work).toContainText('Von dieser Arbeit wurde nichts gesendet.');
  expect(await tauriCalls(page, 'cloud_chat')).toEqual([]);
});

test('shows the check before sending in the browser preview with ?schutz', async ({ page }) => {
  await page.goto('/?schutz');
  await expect(page.getByText('Arbeiten hierher ziehen')).toBeVisible();
  await load(page, [ruledPage('Aufsatz Mia.png', 5).file]);
  await page.getByRole('button', { name: 'Korrigieren', exact: true }).click();

  const review = page.getByRole('dialog', { name: 'Vor dem Senden prüfen' });
  await expect(review.getByRole('button', { name: /zu prüfen$/u })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole('status').filter({ hasText: 'Wartet auf Freigabe (1 Arbeit)' }),
  ).toBeVisible();
  await review.getByLabel('Stelle', { exact: true }).fill('Zeile 2');
  await review.getByRole('combobox', { name: 'Art' }).selectOption('number');
  await review.getByRole('button', { name: 'Ergänzen' }).click();
  await expect(review).toContainText('Zeile 2 [Nummer 1]');
  await review.getByRole('button', { name: '„Zeile 2“ nicht ersetzen' }).click();
  await expect(review).not.toContainText('[Nummer 1]');

  await page.keyboard.press('Escape');
  await expect(review).toBeHidden();
  await page.getByRole('button', { name: 'Vor dem Senden prüfen (1)' }).click();
  await review.getByRole('button', { name: 'Freigeben' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Fertig: / })).toBeVisible({
    timeout: 20_000,
  });
});
