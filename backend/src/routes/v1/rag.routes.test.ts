import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { SupabaseFactory } from "../../repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: ["https://shop.example"], port: 3001 };
const token = () => `header.${Buffer.from(JSON.stringify({ iss: `${env.supabaseUrl}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.signature`;
const adminEndpoints = [
  { method: "GET", url: "/api/v1/admin/rag/index" }, { method: "POST", url: "/api/v1/admin/rag/index" },
  { method: "GET", url: "/api/v1/admin/rag/health" },
] as const;

function fixture(role = "viewer", authResult?: { data: { user: { id: string } | null }; error: { status: number } | null }) {
  const dataAccess = vi.fn(() => { throw new Error("private-token raw-OCR user-id"); });
  const factory = (() => ({
    auth: { getUser: async () => authResult ?? ({ data: { user: { id: "user-id" } }, error: null }) },
    from: (table: string) => table === "profiles"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role }, error: null }) }) }) }
      : dataAccess(),
    rpc: dataAccess,
  })) as SupabaseFactory;
  return { app: buildApp({ env, supabaseFactory: factory }), dataAccess };
}

describe("versioned RAG route boundaries", () => {
  it.each([...adminEndpoints, { method: "POST", url: "/api/v1/rag/query" }, { method: "POST", url: "/api/v1/admin/rag/preview" }] as const)("requires auth for $method $url", async endpoint => {
    const { app } = fixture();
    try {
      const response = await app.inject(endpoint);
      expect(response.statusCode).toBe(401);
      expect(response.headers["cache-control"]).toContain("no-store");
    } finally { await app.close(); }
  });

  it.each(adminEndpoints)("denies non-owner $method $url without data access", async endpoint => {
    const { app, dataAccess } = fixture();
    try {
      const response = await app.inject({ ...endpoint, headers: { authorization: `Bearer ${token()}` } });
      expect(response.statusCode).toBe(403);
      expect(dataAccess).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([{}, { question: " " }, { question: "a".repeat(1001) }, { question: 123 }])("rejects invalid questions before retrieval", async payload => {
    const { app, dataAccess } = fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/rag/query", headers: { authorization: `Bearer ${token()}` }, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
      expect(dataAccess).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("rejects unsupported OCR image types before calling the model", async () => {
    const { app, dataAccess } = fixture("viewer");
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/rag/ocr", headers: { authorization: `Bearer ${token()}` }, payload: { imageBase64: "QUJDREVGR0hJSktMTU4=", mimeType: "image/gif" } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
      expect(dataAccess).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("allows a signed-in viewer to preview OCR text as chunks", async () => {
    const { app } = fixture("viewer");
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/rag/preview", headers: { authorization: `Bearer ${token()}` }, payload: { extractedText: "Tắc kê sắt:\n6 x 50 | 12" } });
      expect(response.statusCode).toBe(200);
      expect(response.json().chunks).toHaveLength(1);
    } finally { await app.close(); }
  });

  it("asks for one price tier before running retrieval when the question conflicts", async () => {
    const { app, dataAccess } = fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/rag/query", headers: { authorization: `Bearer ${token()}` }, payload: { question: "giá sỉ hay giá lẻ tắc kê" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "clarify", items: [], sources: [] });
      expect(response.json().answer).toContain("Vui lòng chọn một loại giá");
      expect(dataAccess).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("returns a safe structured error when a caller-scoped repository fails", async () => {
    const { app } = fixture("owner");
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/rag/pages", headers: { authorization: `Bearer ${token()}` } });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" }, requestId: response.headers["x-request-id"] });
      expect(response.body).not.toMatch(/private-token|raw-OCR|user-id/);
    } finally { await app.close(); }
  });

  it("rejects malformed JSON with a safe client error", async () => {
    const { app } = fixture("owner");
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/rag/preview", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, payload: '{"extractedText":private-secret' });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
      expect(response.body).not.toContain("private-secret");
    } finally { await app.close(); }
  });

  it("allows an exact configured origin to preflight PUT for page review", async () => {
    const { app } = fixture();
    try {
      const response = await app.inject({ method: "OPTIONS", url: "/api/v1/admin/rag/pages", headers: { origin: "https://shop.example", "access-control-request-method": "PUT" } });
      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("https://shop.example");
      expect(response.headers["access-control-allow-methods"]).toContain("PUT");
    } finally { await app.close(); }
  });

  it("returns safe unavailability when query embedding configuration is missing", async () => {
    vi.stubEnv("RAG_EMBEDDING_MODEL", "");
    const { app } = fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/rag/query", headers: { authorization: `Bearer ${token()}` }, payload: { question: "Giá vật tư?" } });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: "RAG_UNAVAILABLE" } });
      expect(response.body).not.toContain("RAG_EMBEDDING_MODEL");
    } finally { await app.close(); vi.unstubAllEnvs(); }
  });

  it("returns diagnostic 503 health details through the declared response schema", async () => {
    vi.stubEnv("RAG_EMBEDDING_MODEL", "");
    vi.stubEnv("RAG_CHAT_MODEL", "");
    const dataAccess = vi.fn();
    const factory = (() => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-id" } }, error: null }) },
      from: (table: string) => table === "profiles"
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "owner" }, error: null }) }) }) }
        : table === "rag_page_texts"
          ? { select: () => ({ eq: async () => ({ count: 0, error: { message: "db unavailable" } }) }) }
          : { select: async () => ({ count: 0, error: { message: "db unavailable" } }) },
    })) as SupabaseFactory;
    const app = buildApp({ env, supabaseFactory: factory });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/rag/health", headers: { authorization: `Bearer ${token()}` } });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ ok: false, database: { ok: false }, embedding: { ok: false }, chat: { ok: false } });
      expect(response.json()).not.toHaveProperty("requestId");
    } finally { await app.close(); vi.unstubAllEnvs(); }
  });

  it("preserves the safe request-id envelope when auth is unavailable before health runs", async () => {
    const { app } = fixture("viewer", { data: { user: null }, error: { status: 503 } });
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/admin/rag/health", headers: { authorization: `Bearer ${token()}` } });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: "AUTH_UNAVAILABLE" }, requestId: response.headers["x-request-id"] });
    } finally { await app.close(); }
  });
});
