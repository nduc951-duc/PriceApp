import { expect, it } from "vitest";
import { Writable } from "node:stream";
import { buildApp } from "../../src/app.js";
import { ApiError } from "../../src/middleware/errors.js";
import type { SupabaseFactory } from "../../src/repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: ["https://shop.example"], port: 3001 };
const unusedFactory = (() => { throw new Error("unexpected auth"); }) as SupabaseFactory;

it("logs safe dependency diagnostics without exposing them in the response", async () => {
  const writes: string[] = [];
  const logStream = new Writable({ write(chunk, _encoding, callback) { writes.push(String(chunk)); callback(); } });
  const app = buildApp({ env, supabaseFactory: unusedFactory, logStream });
  app.get("/dependency-failure", async () => {
    throw new ApiError(503, "RAG_UNAVAILABLE", "Try again", { stage: "generation", upstreamStatus: 429 });
  });
  const response = await app.inject({ method: "GET", url: "/dependency-failure" });
  expect(response.statusCode).toBe(503);
  expect(writes.join("")).toContain('"stage":"generation"');
  expect(writes.join("")).toContain('"upstreamStatus":429');
  expect(response.body).not.toMatch(/generation|upstreamStatus/);
  await app.close();
});

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

it("maps Fastify schema validation failures to a safe 400 response", async () => {
  const app = buildApp({ env, supabaseFactory: unusedFactory });
  app.post("/invalid-body", { schema: { body: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } }, async () => ({ ok: true }));
  const response = await app.inject({ method: "POST", url: "/invalid-body", payload: { private: "request detail" } });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: { code: "INVALID_INPUT", message: "Invalid request body" }, requestId: response.headers["x-request-id"] });
  expect(response.body).not.toContain("request detail");
  await app.close();
});
