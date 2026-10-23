import { expect, test } from '@playwright/test';
import { open, openSettings } from './support.ts';
import { mockTauri, tauriCalls } from './tauri.ts';

test('uses a Claude subscription through the CLI like a cloud provider', async ({ page }) => {
  await mockTauri(page, { totalRamGiB: 16 });
  await open(page);
  const dialog = await openSettings(page);
  const correction = dialog.getByRole('region', { name: 'Korrektur' });
  await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
  await correction
    .getByRole('combobox', { name: 'Anbieter' })
    .selectOption({ label: 'Claude-Abo (Claude Code)' });
  const program = correction.getByRole('group', { name: 'Programm' });
  await expect(program).toContainText('/opt/fake/bin/claude · Version 2.1.299');
  await expect(correction.getByLabel('Schlüssel')).toHaveCount(0);
  await correction.getByRole('combobox', { name: 'Modell' }).selectOption('sonnet');
  await expect(
    correction.getByRole('switch', { name: 'Personenbezug vor dem Senden entfernen' }),
  ).toBeChecked();
  await correction.getByRole('button', { name: 'Verwenden' }).click();
  await correction.getByRole('alertdialog').getByRole('button', { name: 'Verwenden' }).click();
  await expect(correction.getByRole('radio', { name: /^sonnet Cloud/u })).toBeChecked();
  await expect(correction).toContainText('Claude-Abo · /opt/fake/bin/claude · Version 2.1.299');
  const uses = await tauriCalls(page, 'cloud_use');
  expect(uses.at(-1)?.args).toMatchObject({
    step: 'corrector',
    template: 'claude-code',
    baseUrl: 'cli://claude',
    model: 'sonnet',
    key: null,
    cliPath: '/opt/fake/bin/claude',
    confirmed: true,
  });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', {
      name: 'Texterkennung lokal, Korrektur über Claude-Abo, pseudonymisiert, Inhalt und Form lokal',
    }),
  ).toBeVisible();
});

test('says how to sign in when the CLI is not signed in', async ({ page }) => {
  await mockTauri(page, { totalRamGiB: 16, cliFound: false, cloudCheckError: 'notLoggedIn' });
  await open(page);
  const dialog = await openSettings(page);
  const correction = dialog.getByRole('region', { name: 'Korrektur' });
  await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
  await correction.getByRole('combobox', { name: 'Anbieter' }).selectOption('claude-code');
  const program = correction.getByRole('group', { name: 'Programm' });
  await expect(program).toContainText('Nicht gefunden.');
  await program.getByRole('button', { name: 'Datei wählen …' }).click();
  await expect(program).toContainText('/opt/picked/claude · Version 2.1.300');
  await correction.getByRole('combobox', { name: 'Modell' }).selectOption('haiku');
  await correction.getByRole('button', { name: 'Verwenden' }).click();
  await correction.getByRole('alertdialog').getByRole('button', { name: 'Verwenden' }).click();
  await expect(correction).toContainText('Die CLI ist nicht angemeldet.');
  await expect(correction).toContainText('claude auth login');
  await expect(correction.getByRole('radio', { name: /^haiku Cloud/u })).toHaveCount(0);
});

test('offers the Codex subscription with an honest label and a note on a global AGENTS.md', async ({
  page,
}) => {
  await mockTauri(page, { totalRamGiB: 16, codexNotes: ['globalInstructions'] });
  await open(page);
  const dialog = await openSettings(page);
  const correction = dialog.getByRole('region', { name: 'Korrektur' });
  await correction.getByRole('button', { name: 'Cloud-Modell …' }).click();
  await correction
    .getByRole('combobox', { name: 'Anbieter' })
    .selectOption({ label: 'ChatGPT-Abo (Codex, ungetestet)' });
  const program = correction.getByRole('group', { name: 'Programm' });
  await expect(program).toContainText('/opt/fake/bin/codex · Version 0.164.0');
  await expect(program).toContainText('noch nie mit einer echten Codex-Installation');
  await expect(program.getByRole('note')).toContainText('AGENTS.md');
  await correction.getByRole('combobox', { name: 'Modell' }).selectOption('gpt-6-luna');
  await correction.getByRole('button', { name: 'Verwenden' }).click();
  await correction.getByRole('alertdialog').getByRole('button', { name: 'Verwenden' }).click();
  const uses = await tauriCalls(page, 'cloud_use');
  expect(uses.at(-1)?.args).toMatchObject({
    template: 'codex',
    baseUrl: 'cli://codex',
    model: 'gpt-6-luna',
    cliPath: '/opt/fake/bin/codex',
  });
});
