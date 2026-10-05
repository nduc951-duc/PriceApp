import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/api/v1/health", async () => ({ status: "ok" }));
}
