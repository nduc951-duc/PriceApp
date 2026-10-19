import { describe, expect, it } from "vitest";
import { createRagPublicFeedbackHandle, verifyRagPublicFeedbackHandle } from "../../src/services/rag-public-feedback-handle.js";

describe("response-bound public feedback handles", () => {
  it("creates a signed handle for one opaque response and verifies it before expiry", () => {
    const handle = createRagPublicFeedbackHandle("x".repeat(40), 1_800_000_000);
    const verified = verifyRagPublicFeedbackHandle("x".repeat(40), handle, 1_800_000_100);

    expect(handle).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    expect(verified).toMatchObject({ responseId: expect.stringMatching(/^[0-9a-f-]{36}$/i), expiresAt: 1_800_001_800 });
  });

  it("rejects tampered, expired, oversized, and incorrectly signed handles", () => {
    const secret = "x".repeat(40);
    const handle = createRagPublicFeedbackHandle(secret, 1_800_000_000);

    const tampered = `${handle.slice(0, -1)}${handle.endsWith("0") ? "1" : "0"}`;
    expect(verifyRagPublicFeedbackHandle(secret, tampered, 1_800_000_100)).toBeNull();
    expect(verifyRagPublicFeedbackHandle(secret, handle, 1_800_001_801)).toBeNull();
    expect(verifyRagPublicFeedbackHandle("y".repeat(40), handle, 1_800_000_100)).toBeNull();
    expect(verifyRagPublicFeedbackHandle(secret, "x".repeat(513), 1_800_000_100)).toBeNull();
  });
});
