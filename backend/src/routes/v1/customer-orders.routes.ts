import type { FastifyInstance, FastifyRequest } from "fastify";
import { customerOrderInbox, publicCustomerCatalog, setCustomerOrderStatus, submitCustomerOrder } from "../../controllers/customer-orders.controller.js";
import { fastifyRouteSchema, getApiContract } from "../../openapi/contract.js";
import { ApiError } from "../../middleware/errors.js";

const submissionWindowMs = 10 * 60 * 1000;
const submissionLimit = 5;

export function registerCustomerOrderRoutes(app: FastifyInstance): void {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const limitSubmissions = async (request: FastifyRequest) => {
    const now = Date.now();
    if (buckets.size > 1000) for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    const bucket = buckets.get(request.ip);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(request.ip, { count: 1, resetAt: now + submissionWindowMs });
      return;
    }
    if (bucket.count >= submissionLimit) throw new ApiError(429, "TOO_MANY_REQUESTS", "Vui lòng chờ trước khi gửi yêu cầu tiếp theo.");
    bucket.count += 1;
  };

  app.register(async routes => {
    routes.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "no-store, max-age=0");
      reply.header("vary", "Authorization");
    });
    routes.get("/public/catalog", { schema: fastifyRouteSchema(getApiContract("getPublicCustomerCatalog")) }, publicCustomerCatalog);
    routes.post("/public/order-requests", {
      preHandler: [limitSubmissions], schema: fastifyRouteSchema(getApiContract("createPublicCustomerOrder")),
    }, submitCustomerOrder);
    routes.get("/customer-order-requests", {
      preValidation: [app.authenticate, app.requireRole("owner", "editor")],
      schema: fastifyRouteSchema(getApiContract("listCustomerOrderRequests")),
    }, customerOrderInbox);
    routes.patch("/customer-order-requests/:requestId/status", {
      preValidation: [app.authenticate, app.requireRole("owner", "editor")],
      schema: fastifyRouteSchema(getApiContract("updateCustomerOrderStatus")),
    }, setCustomerOrderStatus);
  }, { prefix: "/api/v1" });
}
