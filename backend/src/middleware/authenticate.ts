import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthContext } from "../services/auth.service.js";
import { authenticateToken } from "../services/auth.service.js";
import type { AppEnv } from "../config/env.js";
import type { SupabaseFactory } from "../repositories/supabase-client.js";
import { ApiError } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest { auth?: AuthContext }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthContext>;
    requireRole: (...roles: import("../services/auth.service.js").AppRole[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function createAuthenticate(env: AppEnv, supabaseFactory: SupabaseFactory) {
  return async function authenticate(request: FastifyRequest): Promise<AuthContext> {
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? "");
    if (!match) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    const auth = await authenticateToken(match[1], env, supabaseFactory);
    request.auth = auth;
    return auth;
  };
}
