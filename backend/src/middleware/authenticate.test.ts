import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { SupabaseFactory } from "../repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: ["https://shop.example"], port: 3001 };
const token = (issuer = "project", exp = Math.floor(Date.now() / 1000) + 600) => `header.${Buffer.from(JSON.stringify({ iss: `https://${issuer}.supabase.co/auth/v1`, exp })).toString("base64url")}.signature`;

function factory(role: string = "owner", authError?: Error): SupabaseFactory {
  return (() => ({
    auth: { getUser: async () => {
      if (authError) throw authError;
      return { data: { user: { id: "private-user-id", email: "private@example.com" } }, error: null };
    } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role }, error: null }) }) }) }),
  })) as SupabaseFactory;
}

describe("request authentication", () => {
  it("rejects missing bearer token", async () => {
    const app = buildApp({ env, supabaseFactory: factory() });
    const response = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Authentication required" }, requestId: response.headers["x-request-id"] });
    await app.close();
  });

  it.each([token("other"), token("project", 1)])("rejects expired or wrong-project token", async badToken => {
    const app = buildApp({ env, supabaseFactory: factory() });
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${badToken}` } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    await app.close();
  });

  it("loads owner role for a valid token", async () => {
    const app = buildApp({ env, supabaseFactory: factory() });
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${token()}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: "private-user-id", role: "owner" });
    await app.close();
  });

  it("rejects a token that Supabase Auth reports invalid", async () => {
    const invalidFactory = (() => ({ auth: { getUser: async () => ({ data: { user: null }, error: { status: 401 } }) } })) as SupabaseFactory;
    const app = buildApp({ env, supabaseFactory: invalidFactory });
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${token()}` } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    await app.close();
  });

  it("returns 503 when Supabase Auth reports HTTP 408 timeout", async () => {
    const timeoutFactory = (() => ({ auth: { getUser: async () => ({ data: { user: null }, error: { status: 408 } }) } })) as SupabaseFactory;
    const app = buildApp({ env, supabaseFactory: timeoutFactory });
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${token()}` } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: { code: "AUTH_UNAVAILABLE", message: "Authentication service unavailable" }, requestId: response.headers["x-request-id"] });
    await app.close();
  });

  it("denies viewer on owner route", async () => {
    const app = buildApp({ env, supabaseFactory: factory("viewer") });
    app.get("/owner", { preHandler: [app.authenticate, app.requireRole("owner")] }, async () => ({ ok: true }));
    const response = await app.inject({ method: "GET", url: "/owner", headers: { authorization: `Bearer ${token()}` } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    await app.close();
  });

  it("returns 503 when Supabase Auth is unreachable", async () => {
    const app = buildApp({ env, supabaseFactory: factory("owner", new Error("private-token private@example.com")) });
    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${token()}` } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "AUTH_UNAVAILABLE" } });
    expect(response.body).not.toContain("private-token");
    await app.close();
  });
});
