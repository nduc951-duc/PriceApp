import type { FastifyRequest } from "fastify";
import { getCatalog } from "../services/catalog.service.js";

export const catalog = (request: FastifyRequest) => getCatalog(request.auth!.client);
