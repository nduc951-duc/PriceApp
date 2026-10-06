import type { FastifyInstance } from "fastify";
import { catalog } from "../../controllers/catalog.controller.js";

export function registerCatalogRoutes(app: FastifyInstance): void {
  app.register(async routes => {
    routes.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store, max-age=0");
      reply.header("vary", "Authorization");
    });
    routes.get("/catalog", { preHandler: [app.authenticate] }, catalog);
  }, { prefix: "/api/v1" });
}
