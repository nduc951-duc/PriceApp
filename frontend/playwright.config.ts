import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: { baseURL },
  webServer: {
    command: "npm run start",
    cwd: __dirname,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
