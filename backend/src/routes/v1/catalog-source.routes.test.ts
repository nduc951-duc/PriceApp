import { expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { SupabaseFactory } from "../../repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: [], port: 3001 };
const token = `header.${Buffer.from(JSON.stringify({ iss: `${env.supabaseUrl}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.signature`;
function appFor(storageError: unknown = null) {
  const createSignedUrl = vi.fn().mockResolvedValue({ data: storageError ? null : { signedUrl: "https://private.example/signed" }, error: storageError });
  const from = vi.fn((table: string) => table === "profiles"
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "viewer" }, error: null }) }) }) }
    : { select: () => ({ eq: () => ({ neq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) });
  const storageFrom = vi.fn(() => ({ createSignedUrl }));
  const factory = (() => ({ auth: { getUser: async () => ({ data: { user: { id: "private-user" } }, error: null }) }, from, storage: { from: storageFrom } })) as SupabaseFactory;
  return { app: buildApp({ env, supabaseFactory: factory }), createSignedUrl, storageFrom };
}
const auth = { authorization: `Bearer ${token}` };

it("requires authentication and keeps catalog private", async () => {
  const { app } = appFor();
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/catalog" });
    expect(anonymous.statusCode).toBe(401);
    const response = await app.inject({ method: "GET", url: "/api/v1/catalog", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ entries: [], prices: [], syncedAt: expect.any(String) });
    expect(response.headers["cache-control"]).toContain("no-store");
  } finally { await app.close(); }
});

it.each(["", " ", "../secret", "source-pages/../secret", "/absolute", "https://other.example/file", "a\\b", "a//b", "a?token=x"]) ("rejects invalid source path %s", async storagePath => {
  const { app, createSignedUrl } = appFor();
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/source-files/signed-url", headers: auth, payload: { storagePath } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(createSignedUrl).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it("signs only a valid private bucket object for 300 seconds through caller client", async () => {
  const { app, createSignedUrl, storageFrom } = appFor();
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/source-files/signed-url", headers: auth, payload: { storagePath: "source-pages/scan/page-04.jpg" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ signedUrl: "https://private.example/signed", expiresIn: 300 });
    expect(storageFrom).toHaveBeenCalledWith("source-pages");
    expect(createSignedUrl).toHaveBeenCalledWith("scan/page-04.jpg", 300);
  } finally { await app.close(); }
});

it("does not expose storage policy errors or create a public fallback", async () => {
  const { app } = appFor({ message: "private user-id and storage secret" });
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/source-files/signed-url", headers: auth, payload: { storagePath: "page.jpg" } });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toMatch(/user-id|storage secret/);
  } finally { await app.close(); }
});
