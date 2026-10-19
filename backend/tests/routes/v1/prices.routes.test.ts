import { expect, it } from "vitest";
import { buildApp } from "../../../src/app.js";
import type { SupabaseFactory } from "../../../src/repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: [], port: 3001 };
const unusedFactory = (() => { throw new Error("auth factory should not be reached without a bearer token"); }) as SupabaseFactory;

it.each([
  ["/api/v1/prices/12/update", { amount: 100, expectedVersion: 1, reason: "edit" }],
  ["/api/v1/catalog/update", {}],
  ["/api/v1/prices/undo", { historyId: 3, expectedVersion: 1 }],
])("registers %s behind authentication", async (url, payload) => {
  const app = buildApp({ env, supabaseFactory: unusedFactory });
  const response = await app.inject({ method: "POST", url, payload });
  expect(response.statusCode).toBe(401);
  expect(response.json().error.code).toBe("UNAUTHORIZED");
  await app.close();
});
