import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../middleware/errors.js";
import { chunkRecords, DEFAULT_CHUNK_SETTINGS, normalizeChunkSource } from "../rag/chunking.js";
import { listRagPages, saveRagPage } from "../services/rag-pages.service.js";
import { indexRag, latestRagIndex } from "../services/rag-index.service.js";
import { healthRag } from "../services/rag-health.service.js";
import { latestRagIndexJob } from "../services/rag-index-job-status.js";
import { transcribeImage, type OcrImageInput } from "../rag/ocr.js";

export async function ragPages(request: FastifyRequest) {
  return listRagPages(request.auth!.client, request.auth!.role === "owner");
}

export async function ragSavePage(request: FastifyRequest) {
  return saveRagPage(request.body, request.auth!);
}

export async function ragLatestIndex(request: FastifyRequest) {
  return latestRagIndex(request.auth!.client);
}

export async function ragIndexJobStatus(request: FastifyRequest) {
  return latestRagIndexJob(request.auth!.client);
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
  const body = request.body as { extractedText?: unknown; chunkSettings?: { maxCharacters?: unknown; overlapCharacters?: unknown } } | null | undefined;
  if (typeof body?.extractedText !== "string" || body.extractedText.length > 100_000) {
    throw new ApiError(400, "INVALID_INPUT", "Văn bản xem trước không hợp lệ hoặc vượt quá 100.000 ký tự.");
  }
  const settings = body.chunkSettings ? {
    maxCharacters: Number(body.chunkSettings.maxCharacters), overlapCharacters: Number(body.chunkSettings.overlapCharacters),
  } : DEFAULT_CHUNK_SETTINGS;
  try {
    return { source: normalizeChunkSource(body.extractedText), chunks: chunkRecords(body.extractedText, settings) };
  } catch {
    throw new ApiError(400, "INVALID_INPUT", "Cấu hình chia đoạn không hợp lệ.");
  }
}

export async function ragOcrScan(request: FastifyRequest) {
  return transcribeImage(request.body as OcrImageInput);
}
