import type { FastifyInstance } from "fastify";
import { getMe } from "../controllers/auth.controller.js";
import { fastifyRouteSchema, getApiContract } from "../openapi/contract.js";

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/api/v1/me", { preValidation: app.authenticate, schema: fastifyRouteSchema(getApiContract("getCurrentUser")) }, getMe);
}
