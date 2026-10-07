import { defineConfig, devices } from "@playwright/test";

const enabled = process.env.PRICEAPP_E2E_ENABLED === "true";
const projectRef = process.env.PRICEAPP_E2E_PROJECT_REF;
const supabaseUrl = process.env.PRICEAPP_E2E_SUPABASE_URL;
const publishableKey = process.env.PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY;
const ownerEmail = process.env.PRICEAPP_E2E_OWNER_EMAIL;
const ownerPassword = process.env.PRICEAPP_E2E_OWNER_PASSWORD;
const employeeEmail = process.env.PRICEAPP_E2E_EMPLOYEE_EMAIL;
const employeePassword = process.env.PRICEAPP_E2E_EMPLOYEE_PASSWORD;
const frontendPort = process.env.PRICEAPP_E2E_FRONTEND_PORT ?? "3210";
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;

if (enabled) {
  if (!projectRef || !supabaseUrl || !publishableKey || !ownerEmail || !ownerPassword) {
    throw new Error("E2E enabled without the isolated test project and owner-account secrets.");
  }
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.hostname !== `${projectRef}.supabase.co` || projectRef === "tvznrmnxrgxdwukjsgon") {
    throw new Error("E2E requires a separate Supabase test project; configured project was rejected.");
  }
  if (Boolean(employeeEmail) !== Boolean(employeePassword)) {
    throw new Error("E2E employee email and password must both be configured.");
  }
}

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: { baseURL: frontendOrigin, trace: "off" },
  globalSetup: "./tests/e2e-global-setup.mjs",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
