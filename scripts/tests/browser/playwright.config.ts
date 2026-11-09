import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  fullyParallel: true,
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  globalTimeout: 180_000,
  expect: {timeout: 5_000},
  outputDir: './test-results',
  reporter: [['list'], ['html', {open: 'never'}], ['junit', {outputFile: 'test-results/results.xml'}]],
  use: {
    locale: 'en-US', timezoneId: 'America/Denver',
    serviceWorkers: 'block',
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 1000}}, testIgnore: ['**/packaged*.spec.ts', '**/mobile.spec.ts']},
    {name: 'mobile-chromium', use: {...devices['Pixel 7']}, testMatch: '**/mobile.spec.ts'},
  ],
});
