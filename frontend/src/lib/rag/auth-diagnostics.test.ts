import { describe, expect, it } from "vitest";
import { inspectAccessToken } from "./auth-diagnostics";

function jwt(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

describe("inspectAccessToken", () => {
  it("reports only issuer host and expiry context for a token", () => {
    expect(inspectAccessToken(jwt({ iss: "https://project.supabase.co/auth/v1", exp: 2_000_000_000 }), "https://project.supabase.co"))
      .toEqual({ expectedHost: "project.supabase.co", issuerHost: "project.supabase.co", expired: false });
  });

  it("handles malformed tokens without throwing or exposing token content", () => {
    expect(inspectAccessToken("private-token-value", "https://project.supabase.co"))
      .toEqual({ expectedHost: "project.supabase.co", issuerHost: null, expired: null });
  });
});
