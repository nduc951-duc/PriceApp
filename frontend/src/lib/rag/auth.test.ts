import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { authenticateRagRequest } from "./auth";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const request = (token?: string) => new Request("http://localhost/api/rag/pages", {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

describe("RAG role authentication", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
    mocks.createClient.mockImplementation((_url: string, _key: string, options: { global: { headers: { Authorization: string } } }) => {
      const token = options.global.headers.Authorization.replace("Bearer ", "");
      return {
        auth: { getUser: async () => token === "expired"
          ? { data: { user: null }, error: { message: "expired" } }
          : { data: { user: { id: token } }, error: null } },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: token }, error: null }) }) }) }),
      };
    });
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
    mocks.createClient.mockReset();
  });

  it("requires a real bearer session", async () => {
    expect(await authenticateRagRequest(request(), ["owner"])).toMatchObject({ ok: false, status: 401 });
    expect(await authenticateRagRequest(request("expired"), ["owner"])).toMatchObject({ ok: false, status: 401 });
  });

  it("checks role on every request when a different person signs in", async () => {
    expect(await authenticateRagRequest(request("owner"), ["owner"])).toMatchObject({ ok: true, role: "owner" });
    expect(await authenticateRagRequest(request("viewer"), ["owner"])).toMatchObject({ ok: false, status: 403 });
    expect(await authenticateRagRequest(request("viewer"))).toMatchObject({ ok: true, role: "viewer" });
    expect(mocks.createClient).toHaveBeenCalledTimes(3);
  });
});
