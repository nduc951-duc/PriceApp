import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const handleTtlSeconds = 30 * 60;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VerifiedRagPublicFeedbackHandle = {
  responseId: string;
  expiresAt: number;
  signature: string;
};

function signature(secret: string, responseId: string, expiresAt: number) {
  return createHmac("sha256", secret).update(`${responseId}|${expiresAt}`).digest("hex");
}

export function createRagPublicFeedbackHandle(secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (secret.length < 32) throw new Error("RAG_FEEDBACK_HMAC_SECRET must contain at least 32 characters");
  const responseId = randomUUID();
  const expiresAt = nowSeconds + handleTtlSeconds;
  const payload = Buffer.from(JSON.stringify({ responseId, expiresAt })).toString("base64url");
  return `${payload}.${signature(secret, responseId, expiresAt)}`;
}

export function verifyRagPublicFeedbackHandle(
  secret: string,
  handle: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedRagPublicFeedbackHandle | null {
  if (secret.length < 32 || handle.length > 512) return null;
  const [payload, suppliedSignature, extra] = handle.split(".");
  if (!payload || !suppliedSignature || extra !== undefined || !/^[0-9a-f]{64}$/.test(suppliedSignature)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
  if (typeof decoded !== "object" || decoded === null) return null;
  const value = decoded as { responseId?: unknown; expiresAt?: unknown };
  if (typeof value.responseId !== "string" || !uuidPattern.test(value.responseId)
    || typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= nowSeconds || value.expiresAt > nowSeconds + handleTtlSeconds) return null;
  const expected = Buffer.from(signature(secret, value.responseId, value.expiresAt), "hex");
  const supplied = Buffer.from(suppliedSignature, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return { responseId: value.responseId, expiresAt: value.expiresAt, signature: suppliedSignature };
}
