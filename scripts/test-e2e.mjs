import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run E2E through npm run test:e2e so the npm CLI path is available.");

const enabled = process.env.PRICEAPP_E2E_ENABLED === "true";
const projectRef = process.env.PRICEAPP_E2E_PROJECT_REF;
const supabaseUrl = process.env.PRICEAPP_E2E_SUPABASE_URL;
const publishableKey = process.env.PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY;
if (enabled) {
  if (!projectRef || !supabaseUrl || !publishableKey || !process.env.PRICEAPP_E2E_OWNER_EMAIL || !process.env.PRICEAPP_E2E_OWNER_PASSWORD) {
    throw new Error("E2E enabled without the isolated test project and owner-account secrets.");
  }
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.hostname !== `${projectRef}.supabase.co` || projectRef === "tvznrmnxrgxdwukjsgon") {
    throw new Error("E2E requires a separate Supabase test project; configured project was rejected.");
  }
}

const frontendPort = process.env.PRICEAPP_E2E_FRONTEND_PORT ?? "3210";
const backendPort = process.env.PRICEAPP_E2E_BACKEND_PORT ?? "4210";
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const apiBaseUrl = `http://127.0.0.1:${backendPort}`;
const safeEnv = {
  ...process.env,
  API_PORT: backendPort,
  PORT: frontendPort,
  FRONTEND_ORIGINS: frontendOrigin,
  NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
  NEXT_PUBLIC_SUPABASE_URL: enabled ? supabaseUrl : "https://mock-priceapp.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: enabled ? publishableKey : "mock-publishable-key",
  SUPABASE_URL: enabled ? supabaseUrl : "https://mock-priceapp.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: enabled ? publishableKey : "mock-publishable-key",
  RAG_AI_PROVIDER: "ollama",
  RAG_AI_BASE_URL: "http://127.0.0.1:9",
  RAG_AI_API_KEY: "",
};

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd: root,
      env: safeEnv,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited ${code ?? signal}`));
    });
  });
}

await run(["run", "build", "--workspace", "@price-app/backend"]);
await run(["run", "build", "--workspace", "@price-app/frontend"]);
await run(["run", "test:e2e", "--workspace", "@price-app/frontend"]);
