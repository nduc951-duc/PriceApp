import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { Writable } from "node:stream";
import type { AppEnv } from "./config/env.js";
import { installErrorHandler } from "./middleware/errors.js";
import { installRequestId } from "./middleware/request-id.js";
import { createAuthenticate } from "./middleware/authenticate.js";
import { requireRole } from "./middleware/require-role.js";
import type { SupabaseFactory } from "./repositories/supabase-client.js";
import { registerHealthRoutes } from "./routes/health.routes.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";

export function buildApp(options: { env: AppEnv; supabaseFactory: SupabaseFactory; logStream?: Writable }): FastifyInstance {
  const app = Fastify({ logger: { level: "info", stream: options.logStream, serializers: { req: req => ({ id: req.id }), res: res => ({ statusCode: res.statusCode }) } }, logController: new LogController({ disableRequestLogging: true }) });
  installErrorHandler(app);
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" }, requestId: request.id });
  });
  installRequestId(app);
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    if (!options.env.allowedOrigins.includes(origin)) {
      reply.code(403).send({ error: { code: "FORBIDDEN", message: "Access denied" }, requestId: request.id });
      return;
    }
    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
    reply.header("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    reply.header("access-control-allow-headers", "Authorization, Content-Type");
    if (request.method === "OPTIONS") reply.code(204).send();
  });
  app.decorate("authenticate", createAuthenticate(options.env, options.supabaseFactory));
  app.decorate("requireRole", requireRole);
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  return app;
}
