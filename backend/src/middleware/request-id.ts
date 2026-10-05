import type { FastifyInstance } from "fastify";

export function installRequestId(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
}
