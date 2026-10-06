import { z } from "zod";

const failedCheck = z.strictObject({ ok: z.literal(false), detail: z.string().min(1) });
const databaseCheck = z.union([
  failedCheck,
  z.strictObject({ ok: z.literal(true), detail: z.string().min(1), count: z.number().int().nonnegative() }),
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

export type RagHealthDiagnostics = z.infer<typeof healthSchema>;

export function isRagHealthDiagnostics(value: unknown): value is RagHealthDiagnostics {
  return healthSchema.safeParse(value).success;
}
