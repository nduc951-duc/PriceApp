import { z } from "zod";

export const ragFeedbackParamsSchema = z.object({ conversationId: z.string().uuid() }).strict();
export const ragFeedbackBodySchema = z.object({
  assistantMessageId: z.string().uuid(),
  helpful: z.boolean(),
  reason: z.enum(["missing_data", "retrieval_error", "answer_error", "other"]).optional(),
}).strict().superRefine((value, context) => {
  if (!value.helpful && !value.reason) context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for negative feedback" });
});

export type RagFeedbackInput = z.infer<typeof ragFeedbackBodySchema>;
