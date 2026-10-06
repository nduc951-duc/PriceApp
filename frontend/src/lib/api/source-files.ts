import { requestApi } from "./client";
import type { ApiPaths } from "./generated/api-types";

type SignedUrlResponse = ApiPaths["/api/v1/source-files/signed-url"]["post"]["responses"]["200"]["content"]["application/json"];

export const fetchSourceSignedUrl = (storagePath: string) => requestApi<SignedUrlResponse>(
  "/api/v1/source-files/signed-url", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath }),
  },
);
