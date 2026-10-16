import type { FastifyInstance } from "fastify";
import { ragQuery } from "../../controllers/rag-query.controller.js";
import { ragPages, ragSavePage, ragLatestIndex, ragIndexJobStatus, ragBuildIndex, ragHealth, ragPreview, ragOcrScan } from "../../controllers/rag-admin.controller.js";
import { fastifyRouteSchema, getApiContract } from "../../openapi/contract.js";
import { ragConversationAppend, ragConversationCreate, ragConversationList, ragConversationRead } from "../../controllers/rag-conversations.controller.js";
import { ragFeedbackRead, ragFeedbackSubmit } from "../../controllers/rag-feedback.controller.js";

export function registerRagRoutes(app: FastifyInstance): void {
  app.register(async rag => {
    rag.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store, max-age=0");
      const vary = reply.getHeader("vary");
      reply.header("vary", vary ? `${vary}, Authorization` : "Authorization");
    });
    rag.post("/rag/query", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("queryKnowledgeBase")) }, ragQuery);
    rag.post("/rag/conversations", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("createRagConversation")) }, ragConversationCreate);
    rag.get("/rag/conversations", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("listRagConversations")) }, ragConversationList);
    rag.get("/rag/conversations/:conversationId", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("readRagConversation")) }, ragConversationRead);
    rag.post("/rag/conversations/:conversationId/messages", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("appendRagConversationMessage")) }, ragConversationAppend);
    rag.post("/rag/conversations/:conversationId/feedback", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("submitRagFeedback")) }, ragFeedbackSubmit);
    const authenticated = { preValidation: [app.authenticate] };
    const owner = { preValidation: [app.authenticate, app.requireRole("owner")] };
    rag.get("/admin/rag/feedback", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagFeedbackSummary")) }, ragFeedbackRead);
    rag.get("/admin/rag/pages", { ...authenticated, schema: fastifyRouteSchema(getApiContract("listRagPages")) }, ragPages);
    rag.put("/admin/rag/pages", { ...authenticated, schema: fastifyRouteSchema(getApiContract("saveRagPage")) }, ragSavePage);
    rag.get("/admin/rag/index", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagIndex")) }, ragLatestIndex);
    rag.get("/admin/rag/index-job", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagIndexJobStatus")) }, ragIndexJobStatus);
    rag.post("/admin/rag/index", { ...owner, schema: fastifyRouteSchema(getApiContract("buildRagIndex")) }, ragBuildIndex);
    rag.get("/admin/rag/health", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagHealth")) }, ragHealth);
    rag.post("/admin/rag/preview", { ...authenticated, schema: fastifyRouteSchema(getApiContract("previewRagPage")) }, ragPreview);
    rag.post("/admin/rag/ocr", { ...authenticated, schema: fastifyRouteSchema(getApiContract("scanRagPageOcr")) }, ragOcrScan);
  }, { prefix: "/api/v1" });
}
