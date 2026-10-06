import { requestApi } from "./client";

export const fetchSourceSignedUrl = (storagePath: string) => requestApi<{ signedUrl: string; expiresIn: 300 }>(
  "/api/v1/source-files/signed-url", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath }),
  },
);
