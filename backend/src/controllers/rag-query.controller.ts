import type { FastifyRequest } from "fastify";
import { queryRag } from "../services/rag-query.service.js";
import { ApiError } from "../middleware/errors.js";

export async function ragQuery(request: FastifyRequest) {
  try {
    return await queryRag(request.body, request.auth!.client);
  } catch (error) {
    if (error instanceof Error && /chưa được cấu hình/.test(error.message)) {
      throw new ApiError(503, "RAG_UNAVAILABLE", "Dịch vụ RAG chưa được cấu hình.");
    }
    throw error;
  }
}
