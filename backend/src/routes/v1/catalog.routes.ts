import type { FastifyInstance } from "fastify";
import { catalog } from "../../controllers/catalog.controller.js";
import { fastifyRouteSchema, getApiContract } from "../../openapi/contract.js";

export function registerCatalogRoutes(app: FastifyInstance): void {
  app.register(async routes => {
    routes.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store, max-age=0");
      reply.header("vary", "Authorization");
    });
    routes.get("/catalog", { preValidation: [app.authenticate], schema: fastifyRouteSchema(getApiContract("getCatalog")) }, catalog);
  }, { prefix: "/api/v1" });
}
