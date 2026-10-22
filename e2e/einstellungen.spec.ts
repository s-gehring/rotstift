import { expect, test, type Locator } from '@playwright/test';
import { captureClipboard, copied, open, openSettings } from './support.ts';
import { mockTauri, tauriCalls } from './tauri.ts';

const LOCAL = 'Alles bleibt auf diesem Rechner.';
const CLOUD = 'Cloud-Modelle senden Daten an Drittanbieter.';

function modelRow(section: Locator, name: RegExp): Locator {
  return section.locator('.settings-model').filter({ hasText: name });
}

test.describe('on a laptop with 8 GB', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page, { totalRamGiB: 8 });
    await captureClipboard(page);
    await open(page);
  });

  test('lists the models of every step with size, need and state', async ({ page }) => {
    const dialog = await openSettings(page);
    for (const step of ['Texterkennung', 'Korrektur', 'Inhalt und Form']) {
      await expect(dialog.getByRole('region', { name: step })).toBeVisible();
    }
    const recognition = dialog.getByRole('region', { name: 'Texterkennung' });
    await expect(
      recognition.getByRole('radio', { name: /^GLM-OCR .* braucht etwa .* Bereit$/u }),
    ).toBeChecked();
    await expect(
      modelRow(recognition, /^GLM-OCR/u).locator('.settings-model-need'),
    ).not.toHaveAttribute('data-warn', 'true');
    await expect(
      modelRow(recognition, /^Qwen3-VL/u).locator('.settings-model-need'),
    ).not.toHaveAttribute('data-warn', 'true');
    const correction = dialog.getByRole('region', { name: 'Korrektur' });
    await expect(
      modelRow(correction, /^Gemma 4 E4B/u).locator('.settings-model-need'),
    ).toHaveAttribute('data-warn', 'true');
    await expect(correction.getByRole('radio', { name: /^Gemma 4 E4B/u })).toHaveAccessibleName(
      /braucht etwa .*, mehr als der verfügbare Arbeitsspeicher/u,
    );
    await expect(correction.getByRole('radio', { name: /^Gemma 4 E2B/u })).not.toHaveAccessibleName(
      /Arbeitsspeicher/u,
    );
    await expect(dialog.getByText(`· ${LOCAL}`)).toBeVisible();
  });

  test('sets the models of every step through the thoroughness', async ({ page }) => {
    const dialog = await openSettings(page);
    const levels = dialog.getByRole('region', { name: 'Gründlichkeit' });
    const second = dialog
      .getByRole('region', { name: 'Zweite Lesung' })
      .getByRole('checkbox', { name: /^LightOnOCR-3 0\.8B/u });
    const correction = dialog.getByRole('region', { name: 'Korrektur' });
    const review = dialog.getByRole('region', { name: 'Inhalt und Form' });
    await expect(levels.getByRole('radio')).toHaveCount(3);
    await expect(levels.getByRole('radio', { name: 'Schnell', exact: true })).toBeChecked();
    await expect(
      levels.getByRole('radio', { name: 'Gründlich dauert deutlich länger', exact: true }),
    ).toBeVisible();
    await expect(
      levels.getByRole('radio', { name: 'Sehr gründlich dauert deutlich länger', exact: true }),
    ).toBeVisible();
    await expect(second).not.toBeChecked();

    await levels.getByRole('radio', { name: /^Gründlich/u }).click();
    await expect(levels.getByRole('radio', { name: /^Gründlich/u })).toBeChecked();
    await expect(correction.getByRole('radio', { name: /^Gemma 4 E4B/u })).toBeChecked();
    await expect(review.getByRole('radio', { name: /^Gemma 4 E4B/u })).toBeChecked();
    await expect(second).toBeChecked();

    await levels.getByRole('radio', { name: /^Sehr gründlich/u }).click();
    await expect(correction.getByRole('radio', { name: /^Gemma 4 26B A4B/u })).toBeChecked();
    await expect(review.getByRole('radio', { name: /^Gemma 4 26B A4B/u })).toBeChecked();
    await expect(second).toBeChecked();
    const chosen = await tauriCalls(page, 'model_select_reviewer');
    expect(chosen.map((call) => call.args.modelId)).toEqual([
      'gemma-4-e4b-q4',
      'gemma-4-26b-a4b-q4',
    ]);

    await review.getByRole('radio', { name: /^Gemma 4 E2B/u }).click();
    await expect(levels.getByRole('radio', { name: 'Eigene Auswahl', exact: true })).toBeChecked();

    await levels.getByRole('radio', { name: 'Schnell', exact: true }).click();
    await expect(levels.getByRole('radio', { name: 'Schnell', exact: true })).toBeChecked();
    await expect(levels.getByRole('radio')).toHaveCount(3);
    await expect(correction.getByRole('radio', { name: /^Gemma 4 E2B/u })).toBeChecked();
    await expect(second).not.toBeChecked();
  });

  test('adds an own model from a link, uses it and deletes it again', async ({ page }) => {
    const dialog = await openSettings(page);
    const correction = dialog.getByRole('region', { name: 'Korrektur' });
    await correction.getByRole('button', { name: 'Eigenes Modell …' }).click();
    const link = correction.getByRole('textbox', { name: 'Link zu Hugging Face' });
    const check = correction.getByRole('button', { name: 'Prüfen' });
    await expect(check).toBeDisabled();
    await link.fill('https://huggingface.co/beispiel/klein-GGUF');
    await check.click();
    await expect(correction.getByRole('combobox', { name: 'Modelldatei' })).toHaveValue(
      'klein-Q4_K_M.gguf',
    );
    await expect(correction.getByText(/^beispiel\/klein-GGUF · /u)).toBeVisible();
    await correction.getByRole('button', { name: 'Hinzufügen und laden' }).click();

    const own = correction.getByRole('radio', { name: /beispiel\/klein-GGUF/u });
    await expect(own).toBeChecked();
    await expect(own).toHaveAccessibleName(/Bereit/u);
    await expect(
      dialog
        .getByRole('region', { name: 'Inhalt und Form' })
        .getByRole('radio', { name: /beispiel\/klein-GGUF/u }),
    ).toBeVisible();

    await modelRow(correction, /beispiel\/klein-GGUF/u)
      .getByRole('button', { name: 'Löschen' })
      .click();
    const confirm = correction.getByRole('alertdialog');
    await expect(confirm.getByRole('button', { name: 'Behalten' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Löschen' }).click();
    await expect(own).toHaveCount(0);
    await expect(correction.getByRole('radio', { checked: true })).toHaveCount(1);
  });

  test('offers the provider templates and needs a key only for fixed providers', async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    const correction = dialog.getByRole('region', { name: 'Korrektur' });
    await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
    const provider = correction.getByRole('combobox', { name: 'Anbieter' });
    await expect(provider.getByRole('option')).toHaveText([
      'Anbieter wählen',
      'IONOS AI Model Hub',
      'Mistral AI',
      'STACKIT AI Model Serving',
      'Anthropic',
      'OpenAI',
      'OpenAI (EU-Projekt)',
      'Eigener Server',
      'Anderer Anbieter',
    ]);
    const use = correction.getByRole('button', { name: 'Verwenden' });
    const address = correction.getByRole('textbox', { name: 'Adresse' });

    await provider.selectOption('mistral');
    await expect(address).toHaveCount(0);
    await correction.getByRole('textbox', { name: 'Modell' }).fill('mistral-small-latest');
    await expect(use).toBeDisabled();

    await provider.selectOption('anthropic');
    await expect(correction.getByRole('button', { name: 'Modelle laden' })).toBeDisabled();

    await provider.selectOption('custom');
    await expect(address).toBeVisible();
    await correction.getByRole('textbox', { name: 'Modell' }).fill('klein');
    await expect(use).toBeDisabled();
    await address.fill('https://ki.example.org/v1');
    await expect(use).toBeEnabled();
    await correction.getByRole('button', { name: 'Abbrechen' }).click();
    expect(await tauriCalls(page, 'cloud_use')).toEqual([]);
  });

  test('asks before sending data to a third party and stays local on Abbrechen', async ({
    page,
  }) => {
    const dialog = await openSettings(page);
    const correction = dialog.getByRole('region', { name: 'Korrektur' });
    await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
    await correction.getByRole('combobox', { name: 'Anbieter' }).selectOption('custom');
    await correction.getByRole('textbox', { name: 'Adresse' }).fill('https://ki.example.org/v1');
    await correction.getByRole('textbox', { name: 'Modell' }).fill('klein');
    await correction.getByRole('button', { name: 'Verwenden' }).click();

    const warning = correction.getByRole('alertdialog', { name: 'Cloud-Modell verwenden?' });
    await expect(warning).toContainText('DSGVO');
    await expect(warning.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
    await warning.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(warning).toHaveCount(0);
    await correction.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(correction.getByRole('radio', { name: /^klein/u })).toHaveCount(0);
    await expect(dialog.getByText(`· ${LOCAL}`)).toBeVisible();

    await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
    await correction.getByRole('combobox', { name: 'Anbieter' }).selectOption('custom');
    await correction.getByRole('textbox', { name: 'Adresse' }).fill('https://ki.example.org/v1');
    await correction.getByRole('textbox', { name: 'Modell' }).fill('klein');
    await correction.getByRole('button', { name: 'Verwenden' }).click();
    await correction.getByRole('alertdialog').getByRole('button', { name: 'Verwenden' }).click();

    await expect(correction.getByRole('radio', { name: /^klein Cloud/u })).toBeChecked();
    await expect(dialog.getByText(`· ${CLOUD}`)).toBeVisible();
    const uses = await tauriCalls(page, 'cloud_use');
    expect(uses.map((call) => call.args.confirmed)).toEqual([false, false, true]);

    await correction.getByRole('button', { name: 'Ausschalten' }).click();
    await expect(dialog.getByText(`· ${LOCAL}`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText(`PDF oder Bilder. ${LOCAL}`)).toBeVisible();
  });

  test('uses an own server on this machine without asking', async ({ page }) => {
    const dialog = await openSettings(page);
    const correction = dialog.getByRole('region', { name: 'Korrektur' });
    await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
    await correction.getByRole('combobox', { name: 'Anbieter' }).selectOption('server');
    await correction.getByRole('textbox', { name: 'Adresse' }).fill('http://127.0.0.1:8080/v1');
    await correction.getByRole('textbox', { name: 'Modell' }).fill('lokal');
    await correction.getByRole('button', { name: 'Verwenden' }).click();

    await expect(correction.getByRole('radio', { name: /^lokal Eigener Server/u })).toBeChecked();
    await expect(correction.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog.getByText(`· ${LOCAL}`)).toBeVisible();
  });

  test('shows the Protokoll and copies it', async ({ page }) => {
    const dialog = await openSettings(page);
    await dialog.getByText('Protokoll', { exact: true }).click();
    await expect(dialog.getByLabel('Protokolleinträge')).toContainText('app_start');
    await dialog.getByRole('button', { name: 'Kopieren' }).click();
    await expect(dialog.getByText('Das Protokoll liegt in der Zwischenablage.')).toBeVisible();
    expect((await copied(page)).join('\n')).toContain('app_start');
  });
});

test('notes no slower level where the models fit into the memory', async ({ page }) => {
  await mockTauri(page, { totalRamGiB: 48 });
  await open(page);
  const dialog = await openSettings(page);
  const levels = dialog.getByRole('region', { name: 'Gründlichkeit' });
  await expect(levels.getByRole('radio', { name: 'Sehr gründlich' })).toBeVisible();
  await expect(levels.getByText('dauert deutlich länger')).toHaveCount(0);
});

test('switches a failing server off again', async ({ page }) => {
  await mockTauri(page, { totalRamGiB: 16, cloudCheckFails: true });
  await open(page);
  const dialog = await openSettings(page);
  const correction = dialog.getByRole('region', { name: 'Korrektur' });
  await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
  await correction.getByRole('combobox', { name: 'Anbieter' }).selectOption('server');
  await correction.getByRole('textbox', { name: 'Adresse' }).fill('http://127.0.0.1:8080/v1');
  await correction.getByRole('textbox', { name: 'Modell' }).fill('lokal');
  await correction.getByRole('button', { name: 'Verwenden' }).click();

  await expect(correction.getByRole('alert')).toBeVisible();
  await expect(correction.getByRole('radio', { name: /^lokal/u })).toHaveCount(0);
  expect((await tauriCalls(page, 'cloud_clear')).length).toBeGreaterThan(0);
});
