import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCustomerOrderSubmissionProof } from "./customer-order-signature.js";

describe("customer order submission proof", () => {
  it("creates a fresh nonce and an HMAC over the nonce and timestamp", () => {
    const secret = "test-secret-at-least-32-characters-long";
    const proof = createCustomerOrderSubmissionProof(secret, 1_800_000_000);
    expect(proof.nonce).toMatch(/^[0-9a-f-]{36}$/i);
    expect(proof.timestamp).toBe(1_800_000_000);
    expect(proof.signature).toBe(createHmac("sha256", secret).update(`${proof.nonce}|1800000000`).digest("hex"));
    expect(createCustomerOrderSubmissionProof(secret, 1_800_000_000).nonce).not.toBe(proof.nonce);
  });
});
