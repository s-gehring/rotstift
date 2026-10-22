import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

const PORT = 1430;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'de-DE',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'webkit-start',
      testMatch: 'webkit-start.setup.ts',
      timeout: 120_000,
      use: { ...devices['Desktop Safari'] },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, dependencies: ['webkit-start'] },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
