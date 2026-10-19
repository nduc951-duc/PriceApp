import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { SupabaseFactory } from "../src/repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: ["https://shop.example"], port: 3001 };
const unusedFactory = (() => { throw new Error("unexpected auth"); }) as SupabaseFactory;

it("serves a public health check with a request ID", async () => {
  const app = buildApp({ env, supabaseFactory: unusedFactory });
  const response = await app.inject({ method: "GET", url: "/api/v1/health" });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ status: "ok" });
  expect(response.headers["x-request-id"]).toMatch(/^req-/);
  await app.close();
});

it("allows only an exact configured CORS origin", async () => {
  const app = buildApp({ env, supabaseFactory: unusedFactory });
  const allowed = await app.inject({ method: "OPTIONS", url: "/api/v1/me", headers: { origin: "https://shop.example", "access-control-request-method": "GET" } });
  expect(allowed.statusCode).toBe(204);
  expect(allowed.headers["access-control-allow-origin"]).toBe("https://shop.example");
  const denied = await app.inject({ method: "GET", url: "/api/v1/health", headers: { origin: "https://shop.example.evil" } });
  expect(denied.statusCode).toBe(403);
  expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  await app.close();
});

it("returns request IDs on denied origins without echoing bearer tokens", async () => {
  let output = "";
  const app = buildApp({
    env,
    supabaseFactory: unusedFactory,
    logStream: { write(chunk: string | Uint8Array) { output += String(chunk); return true; } } as NodeJS.WritableStream,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/me",
    headers: { origin: "https://shop.example.evil", authorization: "Bearer e2e-secret-token" },
  });
  expect(response.statusCode).toBe(403);
  expect(response.headers["x-request-id"]).toMatch(/^req-/);
  expect(response.json().requestId).toBe(response.headers["x-request-id"]);
  expect(response.body).not.toContain("e2e-secret-token");
  expect(output).not.toContain("e2e-secret-token");
  await app.close();
});
