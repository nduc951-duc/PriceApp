import type { FastifyInstance } from "fastify";
import { ragQuery } from "../../controllers/rag-query.controller.js";
import { ragPages, ragSavePage, ragLatestIndex, ragBuildIndex, ragHealth, ragPreview } from "../../controllers/rag-admin.controller.js";

export function registerRagRoutes(app: FastifyInstance): void {
  app.register(async rag => {
    rag.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store, max-age=0");
      const vary = reply.getHeader("vary");
      reply.header("vary", vary ? `${vary}, Authorization` : "Authorization");
    });
    rag.post("/rag/query", { preHandler: [app.authenticate] }, ragQuery);
    const owner = { preHandler: [app.authenticate, app.requireRole("owner")] };
    rag.get("/admin/rag/pages", owner, ragPages);
    rag.put("/admin/rag/pages", owner, ragSavePage);
    rag.get("/admin/rag/index", owner, ragLatestIndex);
    rag.post("/admin/rag/index", owner, ragBuildIndex);
    rag.get("/admin/rag/health", owner, ragHealth);
    rag.post("/admin/rag/preview", owner, ragPreview);
  }, { prefix: "/api/v1" });
}
