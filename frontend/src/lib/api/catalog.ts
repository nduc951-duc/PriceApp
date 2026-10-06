import { requestApi } from "./client";
import type { ApiPaths } from "./generated/api-types";

type CatalogContract = ApiPaths["/api/v1/catalog"]["get"]["responses"]["200"]["content"]["application/json"];
export type CatalogEntry = CatalogContract["entries"][number];
export type CatalogPrice = CatalogContract["prices"][number];
export type CatalogResponse = CatalogContract;

export const fetchCatalog = () => requestApi<CatalogResponse>("/api/v1/catalog");
