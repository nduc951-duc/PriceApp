import { createHmac, randomUUID } from "node:crypto";

export type CustomerOrderSubmissionProof = { nonce: string; timestamp: number; signature: string };

export function createCustomerOrderSubmissionProof(secret: string, timestamp = Math.floor(Date.now() / 1000)): CustomerOrderSubmissionProof {
  const nonce = randomUUID();
  const signature = createHmac("sha256", secret).update(`${nonce}|${timestamp}`).digest("hex");
  return { nonce, timestamp, signature };
}
