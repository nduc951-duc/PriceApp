import type { FastifyInstance } from "fastify";
import { sourceSignedUrl } from "../../controllers/source-files.controller.js";

export function registerSourceFilesRoutes(app: FastifyInstance): void {
  app.register(async routes => {
    routes.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store, max-age=0");
      reply.header("vary", "Authorization");
    });
    routes.post("/source-files/signed-url", { preHandler: [app.authenticate] }, sourceSignedUrl);
  }, { prefix: "/api/v1" });
}
