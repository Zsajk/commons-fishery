import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["line"]] : "line",
  use: {
    baseURL: "http://127.0.0.1:5181",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5181/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: "5181",
      GAME_DATA_FILE: ".data/e2e-games.json",
      FACILITATOR_PIN: "workshop",
      SESSION_SECRET: "commons-fishery-e2e-session-secret-123456789",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
