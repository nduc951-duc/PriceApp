import type { FastifyInstance } from "fastify";
import { fastifyRouteSchema, getApiContract } from "../openapi/contract.js";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/api/v1/health", { schema: fastifyRouteSchema(getApiContract("getHealth")) }, async () => ({ status: "ok" }));
}
