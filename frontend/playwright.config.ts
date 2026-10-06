import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const enabled = process.env.PRICEAPP_E2E_ENABLED === "true";
const projectRef = process.env.PRICEAPP_E2E_PROJECT_REF;
const supabaseUrl = process.env.PRICEAPP_E2E_SUPABASE_URL;
const publishableKey = process.env.PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY;
const ownerEmail = process.env.PRICEAPP_E2E_OWNER_EMAIL;
const ownerPassword = process.env.PRICEAPP_E2E_OWNER_PASSWORD;
const employeeEmail = process.env.PRICEAPP_E2E_EMPLOYEE_EMAIL;
const employeePassword = process.env.PRICEAPP_E2E_EMPLOYEE_PASSWORD;
const frontendPort = process.env.PRICEAPP_E2E_FRONTEND_PORT ?? "3210";
const backendPort = process.env.PRICEAPP_E2E_BACKEND_PORT ?? "4210";
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const apiBaseUrl = `http://127.0.0.1:${backendPort}`;

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
  ...(enabled ? {
    webServer: [
      {
        command: "npm run dev",
        cwd: path.resolve(__dirname, "../backend"),
        url: `${apiBaseUrl}/api/v1/health`,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
          API_PORT: backendPort,
          FRONTEND_ORIGINS: frontendOrigin,
          SUPABASE_URL: supabaseUrl!,
          SUPABASE_PUBLISHABLE_KEY: publishableKey!,
          RAG_AI_PROVIDER: "ollama",
          RAG_AI_BASE_URL: "http://127.0.0.1:9",
          RAG_AI_API_KEY: "",
          PRICEAPP_E2E_PROJECT_REF: "",
          PRICEAPP_E2E_SUPABASE_URL: "",
          PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY: "",
          PRICEAPP_E2E_OWNER_EMAIL: "",
          PRICEAPP_E2E_OWNER_PASSWORD: "",
          PRICEAPP_E2E_EMPLOYEE_EMAIL: "",
          PRICEAPP_E2E_EMPLOYEE_PASSWORD: "",
        },
      },
      {
        command: "npm run dev -- --hostname 127.0.0.1",
        cwd: path.resolve(__dirname),
        url: frontendOrigin,
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
          PORT: frontendPort,
          NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
          NEXT_PUBLIC_SUPABASE_URL: supabaseUrl!,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey!,
          PRICEAPP_E2E_PROJECT_REF: "",
          PRICEAPP_E2E_SUPABASE_URL: "",
          PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY: "",
          PRICEAPP_E2E_OWNER_EMAIL: "",
          PRICEAPP_E2E_OWNER_PASSWORD: "",
          PRICEAPP_E2E_EMPLOYEE_EMAIL: "",
          PRICEAPP_E2E_EMPLOYEE_PASSWORD: "",
        },
      },
    ],
  } : {}),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
