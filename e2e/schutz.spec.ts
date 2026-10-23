import { expect, test } from '@playwright/test';
import { open, openSettings } from './support.ts';
import { mockTauri, tauriCalls } from './tauri.ts';

test.beforeEach(async ({ page }) => {
  await mockTauri(page, { totalRamGiB: 16 });
  await open(page);
});

test('keeps the protection on after Abbrechen and allows a cloud recognition once it is off', async ({
  page,
}) => {
  const dialog = await openSettings(page);
  const recognition = dialog.getByRole('region', { name: 'Texterkennung' });
  await recognition.getByRole('button', { name: 'Cloud-Modell …' }).click();
  await recognition.getByRole('combobox', { name: 'Anbieter' }).selectOption('mistral');
  await recognition.getByLabel('Schlüssel').fill('fake-test-key');
  await recognition.getByRole('textbox', { name: 'Modell' }).fill('pixtral-12b');

  const protection = recognition.getByRole('switch', {
    name: 'Personenbezug vor dem Senden entfernen',
  });
  const use = recognition.getByRole('button', { name: 'Verwenden' });
  await expect(protection).toBeChecked();
  await expect(recognition).toContainText('Bei eingeschaltetem Schutz läuft die Erkennung lokal.');
  await expect(use).toBeDisabled();

  await protection.click();
  const warning = recognition.getByRole('alertdialog', { name: 'Personenbezug nicht entfernen?' });
  await expect(warning).toContainText('Handschrift');
  await expect(warning.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await warning.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(warning).toHaveCount(0);
  await expect(protection).toBeChecked();
  await expect(use).toBeDisabled();

  await protection.click();
  await recognition
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Schutz ausschalten' })
    .click();
  await expect(protection).not.toBeChecked();
  await expect(use).toBeEnabled();

  await use.click();
  await recognition.getByRole('alertdialog').getByRole('button', { name: 'Verwenden' }).click();
  await expect(recognition.getByRole('radio', { name: /^pixtral-12b Cloud/u })).toBeChecked();
  const uses = await tauriCalls(page, 'cloud_use');
  expect(uses.at(-1)?.args).toMatchObject({
    step: 'transcriber',
    protection: false,
    protectionConfirmed: true,
    confirmed: true,
  });
});

test('protects a cloud correction by default and names it in the cloud sign', async ({ page }) => {
  const dialog = await openSettings(page);
  const correction = dialog.getByRole('region', { name: 'Korrektur' });
  await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
  await correction.getByRole('combobox', { name: 'Anbieter' }).selectOption('mistral');
  await correction.getByLabel('Schlüssel').fill('fake-test-key');
  await correction.getByRole('textbox', { name: 'Modell' }).fill('mistral-small-latest');
  await expect(
    correction.getByRole('switch', { name: 'Personenbezug vor dem Senden entfernen' }),
  ).toBeChecked();
  await correction.getByRole('button', { name: 'Verwenden' }).click();
  await correction.getByRole('alertdialog').getByRole('button', { name: 'Verwenden' }).click();
  await expect(
    correction.getByRole('radio', { name: /^mistral-small-latest Cloud/u }),
  ).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', {
      name: 'Texterkennung lokal, Korrektur über mistral, pseudonymisiert, Inhalt und Form lokal',
    }),
  ).toBeVisible();
});
