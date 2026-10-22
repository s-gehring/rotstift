import { createCanvas } from '@napi-rs/canvas';
import { expect, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

export interface UploadFile {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

function pagePng(title: string): Buffer {
  const canvas = createCanvas(620, 877);
  const context = canvas.getContext('2d');
  context.fillStyle = '#f7f6f0';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#1c2873';
  context.font = '28px sans-serif';
  context.fillText(title, 70, 100);
  for (let line = 0; line < 12; line += 1) {
    context.fillText('Am Montag sind wir in den Wald gegangen.', 70, 160 + line * 52);
  }
  return canvas.toBuffer('image/png');
}

export function image(name: string): UploadFile {
  return { name, mimeType: 'image/png', buffer: pagePng(name) };
}

export async function pdf(name: string, pages: number): Promise<UploadFile> {
  const document = await PDFDocument.create();
  for (let index = 1; index <= pages; index += 1) {
    const png = await document.embedPng(pagePng(`${name} ${index}`));
    document.addPage([png.width, png.height]).drawImage(png, { x: 0, y: 0 });
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) };
}

export async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Arbeiten hierher ziehen')).toBeVisible();
}

export async function load(page: Page, files: readonly UploadFile[]): Promise<void> {
  await page.locator('input[type=file]').setInputFiles([...files]);
}

export function summary(page: Page): Locator {
  return page.locator('main').getByText(/^\d+ Arbeit(en)? · /);
}

export function menuItem(page: Page, name: string | RegExp): Locator {
  return page.getByRole('menuitem', { name });
}

declare global {
  interface Window {
    copiedTexts: string[];
  }
}

export async function captureClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.copiedTexts = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          window.copiedTexts.push(text);
          return Promise.resolve();
        },
      },
    });
  });
}

export function copied(page: Page): Promise<string[]> {
  return page.evaluate(() => window.copiedTexts);
}

export async function correct(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Korrigieren', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Fertig: / })).toBeVisible({
    timeout: 20_000,
  });
}

export async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
  await expect(dialog).toBeVisible();
  return dialog;
}
