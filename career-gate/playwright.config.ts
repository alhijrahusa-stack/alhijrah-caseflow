import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:3456",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM === "" ? {} : { executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" },
  },
});
