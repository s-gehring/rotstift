import { expect, test as setup } from '@playwright/test';

setup('starts WebKit once before the tests', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Arbeiten hierher ziehen')).toBeVisible();
});
