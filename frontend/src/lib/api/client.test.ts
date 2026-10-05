import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
import { requestApi } from "./client";

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
  const diagnostics = { ok: false, database: { ok: true }, embedding: { ok: false }, chat: { ok: true } };
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(diagnostics), { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  try {
    await expect(requestApi("/api/v1/admin/rag/health")).rejects.toMatchObject({ status: 503, code: "API_REQUEST_FAILED" });
    expect(await requestApi("/api/v1/admin/rag/health", {}, { acceptedStatuses: [503] })).toEqual(diagnostics);
    expect(fetcher.mock.calls[1][1].cache).toBe("no-store");
  } finally { vi.unstubAllGlobals(); }
});

it("keeps authorization errors rejected when only health unavailability is accepted", async () => {
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "private-token" } }, error: null }) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "private-details" } }), { status: 403 })));
  try {
    await expect(requestApi("/api/v1/admin/rag/health", {}, { acceptedStatuses: [503] })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN", message: "FORBIDDEN" });
  } finally { vi.unstubAllGlobals(); }
});

it("rejects structured authentication-service errors even when 503 health diagnostics are accepted", async () => {
  mocks.createClient.mockReturnValue({ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "private-token" } }, error: null }) } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "AUTH_UNAVAILABLE", message: "Authentication service unavailable" } }), { status: 503 })));
  try {
    await expect(requestApi("/api/v1/admin/rag/health", {}, { acceptedStatuses: [503] })).rejects.toMatchObject({ status: 503, code: "AUTH_UNAVAILABLE" });
  } finally { vi.unstubAllGlobals(); }
});
