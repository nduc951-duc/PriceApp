import { expect, it } from "vitest";
import { Writable } from "node:stream";
import { buildApp } from "../app.js";
import type { SupabaseFactory } from "../repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: ["https://shop.example"], port: 3001 };
const unusedFactory = (() => { throw new Error("unexpected auth"); }) as SupabaseFactory;

it("returns a safe, consistent error for an unknown route", async () => {
  const app = buildApp({ env, supabaseFactory: unusedFactory });
  const response = await app.inject({ method: "GET", url: "/private-path?token=secret-value" });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route not found" }, requestId: response.headers["x-request-id"] });
  expect(response.body).not.toContain("secret-value");
  await app.close();
});

it("does not expose an unexpected error message", async () => {
  const writes: string[] = [];
  const logStream = new Writable({ write(chunk, _encoding, callback) { writes.push(String(chunk)); callback(); } });
  const app = buildApp({ env, supabaseFactory: unusedFactory, logStream });
  app.get("/crash", async () => { throw new Error("private-token private@example.com private-user-id"); });
  const response = await app.inject({ method: "GET", url: "/crash" });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" }, requestId: response.headers["x-request-id"] });
  expect(writes.join("")).toContain("INTERNAL_ERROR");
  expect(writes.join("")).not.toMatch(/private-token|private@example\.com|private-user-id/);
  await app.close();
});
