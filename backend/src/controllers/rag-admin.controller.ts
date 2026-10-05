import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../middleware/errors.js";
import { chunkText, normalizeChunkSource } from "../rag/chunking.js";
import { listRagPages, saveRagPage } from "../services/rag-pages.service.js";
import { indexRag, latestRagIndex } from "../services/rag-index.service.js";
import { healthRag } from "../services/rag-health.service.js";

export async function ragPages(request: FastifyRequest) {
  return listRagPages(request.auth!.client);
}

export async function ragSavePage(request: FastifyRequest) {
  return saveRagPage(request.body, request.auth!);
}

export async function ragLatestIndex(request: FastifyRequest) {
  return latestRagIndex(request.auth!.client);
}

export async function ragBuildIndex(request: FastifyRequest) {
  return indexRag(request.auth!.client);
}

export async function ragHealth(request: FastifyRequest, reply: FastifyReply) {
  const health = await healthRag(request.auth!.client);
  reply.code(health.ok ? 200 : 503);
  return health;
}

export async function ragPreview(request: FastifyRequest) {
  const body = request.body as { extractedText?: unknown } | null | undefined;
  if (typeof body?.extractedText !== "string" || body.extractedText.length > 100_000) {
    throw new ApiError(400, "INVALID_INPUT", "Văn bản xem trước không hợp lệ hoặc vượt quá 100.000 ký tự.");
  }
  return { source: normalizeChunkSource(body.extractedText), chunks: chunkText(body.extractedText) };
}
