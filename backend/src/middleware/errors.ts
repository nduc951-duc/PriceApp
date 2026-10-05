import type { FastifyInstance } from "fastify";

export type ApiErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "AUTH_UNAVAILABLE" | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(public readonly statusCode: number, public readonly code: ApiErrorCode, message: string) {
    super(message);
  }
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof ApiError;
    const statusCode = known ? error.statusCode : 500;
    const code = known ? error.code : "INTERNAL_ERROR";
    const message = known ? error.message : "Internal server error";
    request.log.error({ requestId: request.id, statusCode, code }, "request failed");
    reply.code(statusCode).send({ error: { code, message }, requestId: request.id });
  });
}
