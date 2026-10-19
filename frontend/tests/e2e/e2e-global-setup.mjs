import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const enabled = process.env.PRICEAPP_E2E_ENABLED === "true";
const frontendPort = process.env.PRICEAPP_E2E_FRONTEND_PORT ?? "3210";
const backendPort = process.env.PRICEAPP_E2E_BACKEND_PORT ?? "4210";
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const apiBaseUrl = `http://127.0.0.1:${backendPort}`;
const supabaseUrl = enabled ? process.env.PRICEAPP_E2E_SUPABASE_URL : "https://mock-priceapp.supabase.co";
const publishableKey = enabled ? process.env.PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY : "mock-publishable-key";

const appEnv = {
  ...process.env,
  API_PORT: backendPort,
  PORT: frontendPort,
  FRONTEND_ORIGINS: frontendOrigin,
  NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_PUBLISHABLE_KEY: publishableKey,
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
};

function start(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: appEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  child.name = name;
  child.closed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  child.once("error", error => { child.startError = error; });
  return child;
}

async function waitUntilReady(child, url) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.startError) throw child.startError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${child.name} exited before becoming ready (code ${child.exitCode}, signal ${child.signalCode}).`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${child.name} returned HTTP ${response.status} at ${url}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${child.name} did not become ready at ${url}: ${lastError?.message ?? "timeout"}`);
}

async function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      cwd: root,
      stdio: "ignore",
      windowsHide: true,
    });
    const code = await new Promise(resolve => {
      killer.once("error", () => resolve(1));
      killer.once("close", exitCode => resolve(exitCode ?? 1));
    });
    if (code === 0) return;
  }
  child.kill("SIGTERM");
}

export default async function globalSetup() {
  const children = [];
  try {
    const api = start("E2E API", ["backend/dist/server.js"]);
    children.push(api);
    await waitUntilReady(api, `${apiBaseUrl}/api/v1/health`);

    const web = start("E2E frontend", ["node_modules/next/dist/bin/next", "start", "frontend"]);
    children.push(web);
    await waitUntilReady(web, frontendOrigin);
  } catch (error) {
    await Promise.all(children.map(killTree));
    await Promise.all(children.map(child => child.closed));
    throw error;
  }

  return async () => {
    await Promise.all(children.map(killTree));
    await Promise.all(children.map(child => child.closed));
  };
}
