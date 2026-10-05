import type { FastifyRequest } from "fastify";

export async function getMe(request: FastifyRequest) {
  const auth = request.auth!;
  return { userId: auth.user.id, role: auth.role };
}
