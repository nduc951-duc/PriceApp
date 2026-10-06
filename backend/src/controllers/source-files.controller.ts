import type { FastifyRequest } from "fastify";
import { getSourceSignedUrl } from "../services/source-files.service.js";

export const sourceSignedUrl = (request: FastifyRequest) => getSourceSignedUrl(request.auth!.client, request.body);
