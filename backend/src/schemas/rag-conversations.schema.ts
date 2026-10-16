import { z } from "zod";

const uuid = z.string().uuid();
const idList = z.array(z.number().int().positive()).max(40);
const confirmedAttributes = z.record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(200)).refine(value => Object.keys(value).length <= 20);
const metadataBase = z.object({
  status: z.enum(["needs_clarification", "grounded", "abstained"]).optional(),
  confirmedAttributes: confirmedAttributes.optional(),
  variantIds: idList.optional(),
  priceIds: idList.optional(),
}).strict();

export const conversationIdParamsSchema = z.object({ conversationId: uuid }).strict();
export const appendConversationMessageBodySchema = z.object({
  role: z.literal("user"),
  content: z.string().trim().min(1).max(4000),
  metadata: metadataBase.optional(),
}).strict();

export type AppendConversationMessageInput = z.infer<typeof appendConversationMessageBodySchema>;
export type StoredConversationMessageInput = AppendConversationMessageInput | {
  role: "assistant";
  metadata?: Omit<z.infer<typeof metadataBase>, "confirmedAttributes">;
};
