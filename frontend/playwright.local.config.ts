import { defineConfig, devices } from "@playwright/test";

// Read-only UI fixtures against an already running local application.
export default defineConfig({
  testDir: "./tests",
  testMatch: ["customer-order.spec.ts", "storefront-design.spec.ts", "rag-ocr.spec.ts", "rag-query-ui.spec.ts", "customer-rag-query.spec.ts", "staff-search-ui.spec.ts"],
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
