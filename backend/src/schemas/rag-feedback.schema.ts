import { z } from "zod";

export const ragFeedbackParamsSchema = z.object({ conversationId: z.string().uuid() }).strict();
export const ragFeedbackReasonSchema = z.enum(["missing_data", "wrong_product_specification", "wrong_price_or_unit", "missing_or_incorrect_citation", "retrieval_or_provider_failure", "retrieval_error", "answer_error", "other"]);
export const ragFeedbackBodySchema = z.object({
  assistantMessageId: z.string().uuid(),
  helpful: z.boolean(),
  reason: ragFeedbackReasonSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!value.helpful && !value.reason) context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for negative feedback" });
});

export const ragPublicFeedbackBodySchema = z.union([
  z.strictObject({ feedbackHandle: z.string().min(1).max(512), helpful: z.literal(true), reason: ragFeedbackReasonSchema.optional() }),
  z.strictObject({ feedbackHandle: z.string().min(1).max(512), helpful: z.literal(false), reason: ragFeedbackReasonSchema }),
]);

export type RagFeedbackInput = z.infer<typeof ragFeedbackBodySchema>;
