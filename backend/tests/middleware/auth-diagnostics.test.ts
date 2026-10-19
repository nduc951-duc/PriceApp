import { expect, it } from "vitest";
import { inspectAccessToken } from "../../src/middleware/auth-diagnostics.js";

it("returns only safe issuer host and expiry context", () => {
  const token = `header.${Buffer.from(JSON.stringify({ iss: "https://project.supabase.co/auth/v1", exp: 2_000_000_000, sub: "private-user-id", email: "private@example.com" })).toString("base64url")}.signature`;
  const diagnostic = inspectAccessToken(token, "https://project.supabase.co");
  expect(diagnostic).toEqual({ expectedHost: "project.supabase.co", issuerHost: "project.supabase.co", expired: false });
  expect(JSON.stringify(diagnostic)).not.toMatch(/private-user-id|private@example\.com/);
});
