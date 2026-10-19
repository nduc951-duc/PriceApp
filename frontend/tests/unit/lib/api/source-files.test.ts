import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestApi: vi.fn() }));
vi.mock("../../../../src/lib/api/client", () => ({ requestApi: mocks.requestApi }));
import { fetchSourceSignedUrl } from "../../../../src/lib/api/source-files";

it("asks the authenticated API to sign the original storage path", async () => {
  mocks.requestApi.mockResolvedValue({ signedUrl: "https://private.example/signed", expiresIn: 300 });
  expect(await fetchSourceSignedUrl("source-pages/scan.jpg")).toEqual({ signedUrl: "https://private.example/signed", expiresIn: 300 });
  expect(mocks.requestApi).toHaveBeenCalledWith("/api/v1/source-files/signed-url", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storagePath: "source-pages/scan.jpg" }),
  });
});
