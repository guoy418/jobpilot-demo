import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.JOBPILOT_E2E_APP_URL;

if (!baseURL) {
  throw new Error("JOBPILOT_E2E_APP_URL is required. Run npm run test:e2e:local.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/local-api-persistence.e2e.ts",
  timeout: 45_000,
  expect: {
    timeout: 7_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
