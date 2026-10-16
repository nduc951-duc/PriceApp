import type { FastifyReply, FastifyRequest } from "fastify";
import { createCustomerOrderRequest, listCustomerOrderRequests, readPublicCatalog, updateCustomerOrderStatus } from "../repositories/customer-orders.repository.js";
import { ApiError } from "../middleware/errors.js";
import { createCustomerOrderSubmissionProof } from "../services/customer-order-signature.js";

export async function publicCustomerCatalog(request: FastifyRequest) {
  return readPublicCatalog(request.server.publicSupabaseFactory());
}

export async function submitCustomerOrder(request: FastifyRequest, reply: FastifyReply) {
  const secret = request.server.customerOrderHmacSecret;
  if (!secret) throw new ApiError(503, "INTERNAL_ERROR", "Order submissions are not configured");
  const { website: _website, ...input } = request.body as Parameters<typeof createCustomerOrderRequest>[1] & { website?: string };
  const proof = createCustomerOrderSubmissionProof(secret);
  const receipt = await createCustomerOrderRequest(request.server.publicSupabaseFactory(), input, proof);
  return reply.code(201).send(receipt);
}

export async function customerOrderInbox(request: FastifyRequest) {
  return { requests: await listCustomerOrderRequests(request.auth!.client) };
}

export async function setCustomerOrderStatus(request: FastifyRequest) {
  const { requestId } = request.params as { requestId: string };
  const { status } = request.body as { status: "contacted" | "confirmed" | "cancelled" };
  await updateCustomerOrderStatus(request.auth!.client, requestId, status);
  return { updated: true };
}
