import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
import { requestApi, ApiRequestError } from "./client";
import { isRagHealthDiagnostics } from "./rag-health";

const healthDiagnostics = {
  ok: false, provider: "ollama",
  database: { ok: true, detail: "Database ready", count: 10 },
  embedding: { ok: false, detail: "Embedding unavailable" },
  chat: { ok: true, detail: "Chat ready", model: "qwen2.5:1.5b" },
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example";
});

it("uses the current session bearer token for each API request", async () => {
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "private-token" } }, error: null }) } });
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await requestApi<{ status: string }>("/api/v1/health")).toEqual({ status: "ok" });
  expect(fetcher).toHaveBeenCalledWith("https://api.example/api/v1/health", expect.objectContaining({ headers: expect.any(Headers) }));
  expect((fetcher.mock.calls[0][1].headers as Headers).get("Authorization")).toBe("Bearer private-token");
  vi.unstubAllGlobals();
});

it("rejects missing sessions without sending a request", async () => {
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) } });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(requestApi("/api/v1/me")).rejects.toThrow("Authentication required");
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("returns health diagnostics for an explicitly accepted 503 while ordinary requests still reject", async () => {
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "private-token" } }, error: null }) } });
  const diagnostics = healthDiagnostics;
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(diagnostics), { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  try {
    await expect(requestApi("/api/v1/admin/rag/health")).rejects.toMatchObject({ status: 503, code: "API_REQUEST_FAILED" });
    expect(await requestApi("/api/v1/admin/rag/health", {}, { acceptedStatuses: [503], validateAcceptedResponse: isRagHealthDiagnostics })).toEqual(diagnostics);
    expect(fetcher.mock.calls[1][1].cache).toBe("no-store");
  } finally { vi.unstubAllGlobals(); }
});

it("keeps authorization errors rejected when only health unavailability is accepted", async () => {
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "private-token" } }, error: null }) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "private-details" } }), { status: 403 })));
  try {
    await expect(requestApi("/api/v1/admin/rag/health", {}, { acceptedStatuses: [503], validateAcceptedResponse: isRagHealthDiagnostics })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN", message: "FORBIDDEN" });
  } finally { vi.unstubAllGlobals(); }
});

it("rejects structured authentication-service errors even when 503 health diagnostics are accepted", async () => {
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "private-token" } }, error: null }) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "AUTH_UNAVAILABLE", message: "Authentication service unavailable" } }), { status: 503 })));
  try {
    await expect(requestApi("/api/v1/admin/rag/health", {}, { acceptedStatuses: [503], validateAcceptedResponse: isRagHealthDiagnostics })).rejects.toMatchObject({ status: 503, code: "AUTH_UNAVAILABLE" });
  } finally { vi.unstubAllGlobals(); }
});

it.each([
  { message: "service unavailable" },
  { ok: false, database: {}, embedding: {}, chat: {} },
  { ...healthDiagnostics, ok: "false" },
  { ...healthDiagnostics, provider: 123 },
  { ...healthDiagnostics, database: { ok: "true", detail: "Database ready" } },
  { ...healthDiagnostics, database: { ok: true, detail: 123, count: 10 } },
  { ...healthDiagnostics, embedding: { ok: true, detail: "Ready", model: "bge-m3", dimensions: "1024", fingerprint: "0123456789abcdef" } },
  { ...healthDiagnostics, embedding: { ok: true, detail: "Ready", model: "bge-m3", dimensions: 1024, fingerprint: 123 } },
  { ...healthDiagnostics, chat: { ok: true, detail: "Ready", model: 123 } },
  { ...healthDiagnostics, ok: true },
])("rejects malformed health diagnostic 503 envelopes", async body => {
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "private-token" } }, error: null }) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 503 })));
  try {
    await expect(requestApi("/api/v1/admin/rag/health", {}, { acceptedStatuses: [503], validateAcceptedResponse: isRagHealthDiagnostics })).rejects.toBeInstanceOf(ApiRequestError);
  } finally { vi.unstubAllGlobals(); }
});

it("requires a response validator before accepting diagnostic error statuses", async () => {
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "private-token" } }, error: null }) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(healthDiagnostics), { status: 503 })));
  try {
    await expect(requestApi("/api/v1/admin/rag/health", {}, { acceptedStatuses: [503] })).rejects.toBeInstanceOf(ApiRequestError);
  } finally { vi.unstubAllGlobals(); }
});

it("accepts a complete successful embedding check when the database and chat checks fail", async () => {
  const diagnostics = {
    ok: false, provider: "openai",
    database: { ok: false, detail: "Database unavailable" },
    embedding: { ok: true, detail: "Embedding ready", model: "test-1024", dimensions: 1024, fingerprint: "0123456789abcdef" },
    chat: { ok: false, detail: "Chat unavailable" },
  };
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "private-token" } }, error: null }) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(diagnostics), { status: 503 })));
  try {
    expect(await requestApi("/api/v1/admin/rag/health", {}, { acceptedStatuses: [503], validateAcceptedResponse: isRagHealthDiagnostics })).toEqual(diagnostics);
  } finally { vi.unstubAllGlobals(); }
});
