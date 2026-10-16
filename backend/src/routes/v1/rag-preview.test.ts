import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { SupabaseFactory } from "../../repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: ["https://shop.example"], port: 3001 };
const authorization = () => `Bearer header.${Buffer.from(JSON.stringify({ iss: `${env.supabaseUrl}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.signature`;

function fixture(role = "owner") {
  const writes = vi.fn(() => { throw new Error("Preview must not access data"); });
  const factory = (() => ({
    auth: { getUser: async () => ({ data: { user: { id: "private-user" } }, error: null }) },
    from: (table: string) => {
      if (table !== "profiles") return writes();
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role }, error: null }) }) }) };
    },
    rpc: writes,
  })) as SupabaseFactory;
  return { app: buildApp({ env, supabaseFactory: factory }), writes };
}

describe("owner chunk preview", () => {
  it("normalizes indentation/repeated lines and returns exact source offsets without providers or data access", async () => {
    const { app, writes } = fixture();
    const provider = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Preview must not call providers"));
    try {
      const lines = Array.from({ length: 90 }, () => "Tắc kê 8 ly; ghi chú quy cách");
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/rag/preview", headers: { authorization: authorization() }, payload: { extractedText: `\0  ${lines.join("  \r\n  ")}  ` } });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.source).toBe(lines.join("\n"));
      expect(body.chunks.length).toBeGreaterThan(1);
      for (const chunk of body.chunks) expect(body.source.slice(chunk.start, chunk.end)).toBe(chunk.content);
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.headers.vary).toContain("Authorization");
      expect(writes).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
    } finally { provider.mockRestore(); await app.close(); }
  });

  it("returns no chunks for empty text", async () => {
    const { app } = fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/rag/preview", headers: { authorization: authorization() }, payload: { extractedText: " \r\n\0 " } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ source: "", chunks: [] });
    } finally { await app.close(); }
  });

  it("preserves spaces between sentences in a long single-line preview", async () => {
    const { app, writes } = fixture();
    const first = `${"a".repeat(399)}.`;
    const second = `${"b".repeat(399)}.`;
    const third = `${"c".repeat(399)}.`;
    const source = `${first} ${second} ${third}`;
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/rag/preview", headers: { authorization: authorization() }, payload: { extractedText: source } });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.source).toBe(source);
      expect(body.chunks).toHaveLength(2);
      expect(body.chunks[0]).toEqual({ index: 0, content: `${first} ${second}`, start: 0, end: 801, heading: null });
      for (const chunk of body.chunks) expect(source.slice(chunk.start, chunk.end)).toBe(chunk.content);
      expect(writes).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([{}, { extractedText: 42 }, { extractedText: "a".repeat(100_001) }])("rejects invalid preview input", async payload => {
    const { app, writes } = fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/rag/preview", headers: { authorization: authorization() }, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
      expect(writes).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each(["editor", "viewer"])("allows %s to preview OCR chunks without data access", async role => {
    const { app, writes } = fixture(role);
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/admin/rag/preview", headers: { authorization: authorization() }, payload: { extractedText: "private OCR" } });
      expect(response.statusCode).toBe(200);
      expect(response.json().chunks).toHaveLength(1);
      expect(writes).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
