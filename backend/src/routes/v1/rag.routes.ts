import type { FastifyInstance } from "fastify";
import { ragQuery } from "../../controllers/rag-query.controller.js";
import { ragPages, ragSavePage, ragLatestIndex, ragBuildIndex, ragHealth, ragPreview } from "../../controllers/rag-admin.controller.js";
import { fastifyRouteSchema, getApiContract } from "../../openapi/contract.js";

export function registerRagRoutes(app: FastifyInstance): void {
  app.register(async rag => {
    rag.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store, max-age=0");
      const vary = reply.getHeader("vary");
      reply.header("vary", vary ? `${vary}, Authorization` : "Authorization");
    });
    rag.post("/rag/query", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("queryKnowledgeBase")) }, ragQuery);
    const owner = { preValidation: [app.authenticate, app.requireRole("owner")] };
    rag.get("/admin/rag/pages", { ...owner, schema: fastifyRouteSchema(getApiContract("listRagPages")) }, ragPages);
    rag.put("/admin/rag/pages", { ...owner, schema: fastifyRouteSchema(getApiContract("saveRagPage")) }, ragSavePage);
    rag.get("/admin/rag/index", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagIndex")) }, ragLatestIndex);
    rag.post("/admin/rag/index", { ...owner, schema: fastifyRouteSchema(getApiContract("buildRagIndex")) }, ragBuildIndex);
    rag.get("/admin/rag/health", { ...owner, schema: fastifyRouteSchema(getApiContract("getRagHealth")) }, ragHealth);
    rag.post("/admin/rag/preview", { ...owner, schema: fastifyRouteSchema(getApiContract("previewRagPage")) }, ragPreview);
  }, { prefix: "/api/v1" });
}
