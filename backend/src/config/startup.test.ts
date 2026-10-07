import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "vitest";

const backendRoot = resolve(fileURLToPath(import.meta.url), "../../..");

describe("backend startup environment", () => {
  it("starts from process environment when no local env file exists", async () => {
    const manifest = JSON.parse(await readFile(resolve(backendRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.match(manifest.scripts.dev!, /--env-file-if-exists=\.env\.local/);
    assert.match(manifest.scripts.start!, /--env-file-if-exists=\.env\.local/);

    const socket = createServer();
    await new Promise<void>((resolveListen, reject) => {
      socket.once("error", reject);
      socket.listen(0, "127.0.0.1", () => resolveListen());
    });
    const address = socket.address();
    if (!address || typeof address === "string") throw new Error("Could not allocate an API test port");
    const port = address.port;
    await new Promise<void>((resolveClose, reject) => socket.close((error) => error ? reject(error) : resolveClose()));

    const noEnvDirectory = await mkdtemp(resolve(tmpdir(), "priceapp-no-env-"));
    const loader = pathToFileURL(resolve(backendRoot, "../node_modules/tsx/dist/loader.mjs")).href;
    const serverEntry = resolve(backendRoot, "src/server.ts");
    const child = spawn(process.execPath, ["--env-file-if-exists=.env.local", "--import", loader, serverEntry], {
      cwd: noEnvDirectory,
      env: {
        ...process.env,
        API_PORT: String(port),
        FRONTEND_ORIGINS: "http://127.0.0.1:3210",
        SUPABASE_URL: "https://startup-test.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "startup-test-public-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let startupOutput = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { startupOutput += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { startupOutput += chunk; });

    try {
      const deadline = Date.now() + 12_000;
      let response: Response | undefined;
      while (Date.now() < deadline && child.exitCode === null) {
        try { response = await fetch(`http://127.0.0.1:${port}/api/v1/health`); break; }
        catch { await new Promise((resolveDelay) => setTimeout(resolveDelay, 100)); }
      }
      assert.equal(child.exitCode, null, `backend exited before becoming ready: ${startupOutput}`);
      assert.equal(response?.status, 200);
      assert.deepEqual(await response!.json(), { status: "ok" });
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await once(child, "close");
      }
      await rm(noEnvDirectory, { recursive: true, force: true });
    }
  }, 20_000);
});
