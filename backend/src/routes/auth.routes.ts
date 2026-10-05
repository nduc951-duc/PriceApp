import type { FastifyInstance } from "fastify";
import { getMe } from "../controllers/auth.controller.js";

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/api/v1/me", { preHandler: app.authenticate }, getMe);
}
