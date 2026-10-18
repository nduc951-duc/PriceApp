import type { FastifyReply, FastifyRequest } from "fastify";
import { indexRag, latestRagIndex } from "../services/rag-index.service.js";
import { healthRag } from "../services/rag-health.service.js";
import { latestRagIndexJob } from "../services/rag-index-job-status.js";

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
