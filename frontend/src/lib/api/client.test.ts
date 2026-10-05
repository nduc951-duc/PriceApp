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
