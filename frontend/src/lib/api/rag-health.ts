import { z } from "zod";
import type { ApiResponse } from "./generated/api-types";

const failedCheck = z.strictObject({ ok: z.literal(false), detail: z.string().min(1) });
const databaseCheck = z.union([
  failedCheck,
  z.strictObject({ ok: z.literal(true), detail: z.string().min(1), count: z.number().int().nonnegative(), catalogVariants: z.number().int().nonnegative().optional(), embeddedVariants: z.number().int().nonnegative().optional(), missingVariants: z.number().int().nonnegative().optional(), activeGeneration: z.number().int().positive().nullable().optional() }),
]);
const embeddingCheck = z.union([
  failedCheck,
  z.strictObject({
    ok: z.literal(true), detail: z.string().min(1), model: z.string().min(1),
    dimensions: z.literal(1024), fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  }),
]);
const chatCheck = z.union([
  failedCheck,
  z.strictObject({ ok: z.literal(true), detail: z.string().min(1), model: z.string().min(1) }),
]);
const healthSchema = z.strictObject({
  ok: z.boolean(), provider: z.string().min(1),
  database: databaseCheck, embedding: embeddingCheck, chat: chatCheck,
}).refine(health => health.ok === (health.database.ok && health.embedding.ok && health.chat.ok));

export type RagHealthDiagnostics = ApiResponse<"/api/v1/admin/rag/health", "get">;

export function isRagHealthDiagnostics(value: unknown): value is RagHealthDiagnostics {
  return healthSchema.safeParse(value).success;
}
