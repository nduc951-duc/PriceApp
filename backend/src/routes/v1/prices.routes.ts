import type { FastifyInstance } from "fastify";
import { catalogUpdate, priceUndo, priceUpdate } from "../../controllers/prices.controller.js";

export function registerPricesRoutes(app: FastifyInstance): void {
  app.register(async routes => {
    routes.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store, max-age=0");
      reply.header("vary", "Authorization");
    });
    const editor = { preHandler: [app.authenticate, app.requireRole("owner", "editor")] };
    routes.post("/prices/:priceId/update", editor, priceUpdate);
    routes.post("/catalog/update", { preHandler: [app.authenticate, app.requireRole("owner")] }, catalogUpdate);
    routes.post("/prices/undo", editor, priceUndo);
  }, { prefix: "/api/v1" });
}
