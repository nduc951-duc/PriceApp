import type { ApiPaths } from "./generated/api-types";
import { requestApi, requestPublicApi } from "./client";

type PublicCatalog = ApiPaths["/api/v1/public/catalog"]["get"]["responses"]["200"]["content"]["application/json"];
type OrderSubmission = ApiPaths["/api/v1/public/order-requests"]["post"]["requestBody"]["content"]["application/json"];
type OrderReceipt = ApiPaths["/api/v1/public/order-requests"]["post"]["responses"]["201"]["content"]["application/json"];
type OrderRequests = ApiPaths["/api/v1/customer-order-requests"]["get"]["responses"]["200"]["content"]["application/json"];
type UpdateStatus = ApiPaths["/api/v1/customer-order-requests/{requestId}/status"]["patch"]["requestBody"]["content"]["application/json"];

export type CustomerOrderRequest = OrderRequests["requests"][number];
export type CustomerOrderStatus = UpdateStatus["status"];

export function fetchPublicCustomerCatalog(): Promise<PublicCatalog> {
  return requestPublicApi("/api/v1/public/catalog");
}

export function submitPublicCustomerOrder(body: Omit<OrderSubmission, "website">): Promise<OrderReceipt> {
  return requestPublicApi("/api/v1/public/order-requests", { method: "POST", body: JSON.stringify(body) });
}

export function fetchCustomerOrderRequests(): Promise<OrderRequests> {
  return requestApi("/api/v1/customer-order-requests");
}

export function updateCustomerOrderStatus(requestId: string, status: CustomerOrderStatus): Promise<{ updated: true }> {
  return requestApi(`/api/v1/customer-order-requests/${requestId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
}
