import type { FastifyInstance } from "fastify";

export type ApiErrorCode = "UNAUTHORIZED" | "FORBIDDEN" | "AUTH_UNAVAILABLE" | "INTERNAL_ERROR" | "INVALID_INPUT" | "CONFLICT" | "NOT_FOUND" | "SOURCE_CHANGED" | "RAG_UNAVAILABLE";

export class ApiError extends Error {
  constructor(public readonly statusCode: number, public readonly code: ApiErrorCode, message: string) {
    super(message);
  }
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const known = error instanceof ApiError;
    const parserCode = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const invalidJson = parserCode === "FST_ERR_CTP_INVALID_JSON_BODY" || parserCode === "FST_ERR_CTP_EMPTY_JSON_BODY";
    const invalidSchema = parserCode === "FST_ERR_VALIDATION";
    const invalidInput = invalidJson || invalidSchema;
    const statusCode = known ? error.statusCode : invalidInput ? 400 : 500;
    const code = known ? error.code : invalidInput ? "INVALID_INPUT" : "INTERNAL_ERROR";
    const message = known ? error.message : invalidInput ? "Invalid request body" : "Internal server error";
    request.log.error({ requestId: request.id, statusCode, code }, "request failed");
    reply.code(statusCode).send({ error: { code, message }, requestId: request.id });
  });
}
