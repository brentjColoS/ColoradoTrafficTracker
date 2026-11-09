import {defineConfig, devices} from '@playwright/test';
import base from './playwright.config';

export default defineConfig({...base,
  outputDir: './api-test-results',
  reporter: [['list'], ['html', {open: 'never', outputFolder: 'api-playwright-report'}], ['junit', {outputFile: 'api-test-results/results.xml'}]],
  fullyParallel: false,
  workers: 1,
  globalSetup: './support/api-runtime.ts',
  projects: [{name: 'packaged-api', use: {...devices['Desktop Chrome']}, testMatch: '**/packaged*.spec.ts'}],
});
