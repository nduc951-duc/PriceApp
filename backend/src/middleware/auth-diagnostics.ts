export type AccessTokenDiagnostic = { expectedHost: string | null; issuerHost: string | null; expired: boolean | null };

/** Routing and expiry context only; never returns claims or token text. */
export function inspectAccessToken(token: string, supabaseUrl: string): AccessTokenDiagnostic {
  let expectedHost: string | null = null;
  let issuerHost: string | null = null;
  let expired: boolean | null = null;
  try { expectedHost = new URL(supabaseUrl).host; } catch { /* checked by config */ }
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return { expectedHost, issuerHost, expired };
    const payload: unknown = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    if (typeof payload !== "object" || payload === null) return { expectedHost, issuerHost, expired };
    const claims = payload as { iss?: unknown; exp?: unknown };
    if (typeof claims.iss === "string") issuerHost = new URL(claims.iss).host;
    if (typeof claims.exp === "number") expired = claims.exp <= Math.floor(Date.now() / 1000);
  } catch { /* malformed bearer token */ }
  return { expectedHost, issuerHost, expired };
}
