import type { FastifyInstance } from "fastify";
import { publicRagFeedback, publicRagQuery, ragQuery } from "../../controllers/rag-query.controller.js";
import { ragLatestIndex, ragIndexJobStatus, ragBuildIndex, ragHealth } from "../../controllers/rag-admin.controller.js";
import { fastifyRouteSchema, getApiContract } from "../../openapi/contract.js";
import { ragConversationAppend, ragConversationCreate, ragConversationList, ragConversationRead } from "../../controllers/rag-conversations.controller.js";
import { ragFeedbackRead, ragFeedbackSubmit } from "../../controllers/rag-feedback.controller.js";
import { ApiError } from "../../middleware/errors.js";

const publicQueryWindowMs = 60_000;
const publicQueryLimit = 5;
const publicFeedbackWindowMs = 60 * 60_000;
const publicFeedbackLimit = 10;

export function registerRagRoutes(app: FastifyInstance): void {
  const publicQueryBuckets = new Map<string, { count: number; resetAt: number }>();
  const publicFeedbackBuckets = new Map<string, { count: number; resetAt: number }>();
  const limitPublicQueries = async (request: import("fastify").FastifyRequest) => {
    const now = Date.now();
    if (publicQueryBuckets.size > 1000) for (const [key, bucket] of publicQueryBuckets) if (bucket.resetAt <= now) publicQueryBuckets.delete(key);
    const bucket = publicQueryBuckets.get(request.ip);
    if (!bucket || bucket.resetAt <= now) {
      publicQueryBuckets.set(request.ip, { count: 1, resetAt: now + publicQueryWindowMs });
      return;
    }
    if (bucket.count >= publicQueryLimit) throw new ApiError(429, "TOO_MANY_REQUESTS", "Bạn đã gửi nhiều câu hỏi. Vui lòng đợi một phút rồi thử lại.");
    bucket.count += 1;
  };
  const limitPublicFeedback = async (request: import("fastify").FastifyRequest) => {
    const now = Date.now();
    if (publicFeedbackBuckets.size > 1000) for (const [key, bucket] of publicFeedbackBuckets) if (bucket.resetAt <= now) publicFeedbackBuckets.delete(key);
    const bucket = publicFeedbackBuckets.get(request.ip);
    if (!bucket || bucket.resetAt <= now) {
      publicFeedbackBuckets.set(request.ip, { count: 1, resetAt: now + publicFeedbackWindowMs });
      return;
    }
    if (bucket.count >= publicFeedbackLimit) throw new ApiError(429, "TOO_MANY_REQUESTS", "Feedback rate limit reached");
    bucket.count += 1;
  };

  app.register(async rag => {
    rag.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store, max-age=0");
      const vary = reply.getHeader("vary");
      reply.header("vary", vary ? `${vary}, Authorization` : "Authorization");
    });
    rag.post("/public/rag/query", { preHandler: [limitPublicQueries], schema: fastifyRouteSchema(getApiContract("queryPublicKnowledgeBase")) }, publicRagQuery);
    rag.post("/public/rag/feedback", { preHandler: [limitPublicFeedback], schema: fastifyRouteSchema(getApiContract("submitPublicRagFeedback")) }, publicRagFeedback);
    rag.post("/rag/query", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("queryKnowledgeBase")) }, ragQuery);
    rag.post("/rag/conversations", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("createRagConversation")) }, ragConversationCreate);
    rag.get("/rag/conversations", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("listRagConversations")) }, ragConversationList);
    rag.get("/rag/conversations/:conversationId", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("readRagConversation")) }, ragConversationRead);
    rag.post("/rag/conversations/:conversationId/messages", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("appendRagConversationMessage")) }, ragConversationAppend);
    rag.post("/rag/conversations/:conversationId/feedback", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("submitRagFeedback")) }, ragFeedbackSubmit);
    const owner = { preValidation: [app.authenticate, app.requireRole("owner")] };
    rag.get("/admin/rag/feedback", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagFeedbackSummary")) }, ragFeedbackRead);
    rag.get("/admin/rag/index", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagIndex")) }, ragLatestIndex);
    rag.get("/admin/rag/index-job", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagIndexJobStatus")) }, ragIndexJobStatus);
    rag.post("/admin/rag/index", { ...owner, schema: fastifyRouteSchema(getApiContract("buildRagIndex")) }, ragBuildIndex);
    rag.get("/admin/rag/health", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagHealth")) }, ragHealth);
  }, { prefix: "/api/v1" });
}
