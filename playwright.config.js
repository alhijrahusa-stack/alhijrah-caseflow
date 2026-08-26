import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const preinstalledChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chromiumPath = fs.existsSync(preinstalledChromium) ? preinstalledChromium : undefined;

const port = Number(process.env.PORT || 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : [['list']],
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // The API sets Secure cookies. Chromium treats http://localhost as a
    // trustworthy origin, so the real cookie flags are exercised as shipped.
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use the Chromium already provisioned in the execution image when it
        // is present, so the suite runs without a browser download. Falls back
        // to Playwright's managed browser everywhere else.
        launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
      },
    },
  ],
  webServer: {
    command: 'node e2e/support/start.mjs',
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { PORT: String(port) },
  },
});
