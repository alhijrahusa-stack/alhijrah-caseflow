import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

const executablePath = process.env.PW_CHROMIUM ?? (fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome") ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" : undefined);

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: executablePath ? { executablePath } : {} } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} } },
  ],
  webServer: [
    {
      command: "../backend/.venv/bin/python ../backend/tests/e2e_stack.py",
      cwd: ".",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PYTHONPATH: "../backend" },
    },
    {
      command: "npx next start -p 3100 -H 127.0.0.1",
      url: "http://127.0.0.1:3100/login",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { BACKEND_INTERNAL_URL: "http://127.0.0.1:8000" },
    },
  ],
});
