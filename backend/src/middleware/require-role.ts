import type { FastifyRequest } from "fastify";
import type { AppRole } from "../services/auth.service.js";
import { ApiError } from "./errors.js";

export function requireRole(...roles: AppRole[]) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.auth) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    if (!roles.includes(request.auth.role)) throw new ApiError(403, "FORBIDDEN", "Access denied");
  };
}
