import type { FastifyInstance } from "fastify";
import { catalogUpdate, demoPriceApply, demoPricePreview, demoPriceRollback, priceUndo, priceUpdate } from "../../controllers/prices.controller.js";
import { fastifyRouteSchema, getApiContract } from "../../openapi/contract.js";

export function registerPricesRoutes(app: FastifyInstance): void {
  app.register(async routes => {
    routes.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store, max-age=0");
      reply.header("vary", "Authorization");
    });
    const editor = { preValidation: [app.authenticate, app.requireRole("owner", "editor")] };
    routes.post("/prices/:priceId/update", { ...editor, schema: fastifyRouteSchema(getApiContract("updatePrice")) }, priceUpdate);
    routes.post("/catalog/update", { preValidation: [app.authenticate, app.requireRole("owner")], schema: fastifyRouteSchema(getApiContract("updateCatalogItem")) }, catalogUpdate);
    routes.post("/prices/undo", { ...editor, schema: fastifyRouteSchema(getApiContract("undoPrice")) }, priceUndo);
    const owner = { preValidation: [app.authenticate, app.requireRole("owner")] };
    routes.get("/admin/demo-prices/preview", { ...owner, schema: fastifyRouteSchema(getApiContract("previewDemoPrices")) }, demoPricePreview);
    routes.post("/admin/demo-prices/apply", { ...owner, schema: fastifyRouteSchema(getApiContract("applyDemoPrices")) }, demoPriceApply);
    routes.post("/admin/demo-prices/rollback", { ...owner, schema: fastifyRouteSchema(getApiContract("rollbackDemoPrices")) }, demoPriceRollback);
  }, { prefix: "/api/v1" });
}
