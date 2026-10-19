import { describe, expect, it } from "vitest";

async function loadEvidenceBuilder() {
  const loaded = await import(/* @vite-ignore */ new URL("../../src/rag/evidence.ts", import.meta.url).href).catch(() => null);
  expect(loaded, "typed evidence assembly should be available").not.toBeNull();
  return loaded;
}

describe("authorized RAG evidence packets", () => {
  it("keeps only verified public variants, currently valid public prices, and current catalog chunks", async () => {
    const evidence = await loadEvidenceBuilder();
    if (!evidence) return;
    const packet = evidence.buildEvidencePacket({
      role: "customer",
      now: new Date("2026-10-17T00:00:00.000Z"),
      variants: [
        { id: 1, productId: 10, productName: "Tắc kê", variant: "6x50", category: "Vật tư", aliases: ["tắc kê sắt"], attributes: { material: "sắt" }, active: true, verificationStatus: "verified", sourcePages: [11] },
        { id: 2, productId: 10, productName: "Tắc kê", variant: "8x60", category: "Vật tư", aliases: [], attributes: {}, active: false, verificationStatus: "verified", sourcePages: [] },
        { id: 3, productId: 10, productName: "Tắc kê", variant: "10x80", category: "Vật tư", aliases: [], attributes: {}, active: true, verificationStatus: "needs_review", sourcePages: [] },
      ],
      prices: [
        { id: 101, variantId: 1, packageId: 201, version: 3, amount: 34000, tier: "retail", minimumQuantity: 1, packageName: "Bịch", packageQuantity: 10, unit: "cái", priceListName: "Sổ giá", supplierName: "Cửa hàng", currency: "VND", active: true, validFrom: "2026-10-01T00:00:00.000Z", validTo: null, isSample: false, supplierActive: true },
        { id: 102, variantId: 1, packageId: 201, version: 1, amount: 99000, tier: "dealer", minimumQuantity: 1, packageName: "Bịch", packageQuantity: 10, unit: "cái", priceListName: "Nội bộ", supplierName: "Cửa hàng", currency: "VND", active: true, validFrom: "2026-10-01T00:00:00.000Z", validTo: null, isSample: false, supplierActive: true },
        { id: 103, variantId: 1, packageId: 201, version: 1, amount: 12000, tier: "retail", minimumQuantity: 1, packageName: "Bịch", packageQuantity: 10, unit: "cái", priceListName: "Sổ cũ", supplierName: "Cửa hàng", currency: "VND", active: true, validFrom: "2026-09-01T00:00:00.000Z", validTo: "2026-10-01T00:00:00.000Z", isSample: false, supplierActive: true },
      ],
      documents: [
        { id: 501, variantId: 1, sourcePageId: 11, pageNumber: 11, sourceRevision: null, sourceSpan: null, chunkKey: "variant:1:0", content: "Thông tin vật tư đã được kiểm tra.", evidenceKind: "verified_catalog", current: true, publicVisible: true },
        { id: 502, variantId: 1, sourcePageId: 11, pageNumber: 11, sourceRevision: null, sourceSpan: null, chunkKey: "stale", content: "Cũ.", evidenceKind: "verified_catalog", current: false, publicVisible: true },
        { id: 503, variantId: 1, sourcePageId: 12, pageNumber: 12, sourceRevision: null, sourceSpan: null, chunkKey: "private", content: "Private staff note.", evidenceKind: "verified_catalog", current: true, publicVisible: false },
        { id: 504, variantId: 1, sourcePageId: null, pageNumber: null, sourceRevision: null, sourceSpan: null, chunkKey: "variant:1:1", content: "Dòng catalog không có trang ảnh.", evidenceKind: "verified_catalog", current: true, publicVisible: true },
      ],
      catalogPage: { total: 3, nextCursor: null, complete: true },
    });

    expect(packet.entries.map((entry: { id: string }) => entry.id)).toEqual(["variant:1", "price:101", "chunk:501", "chunk:504"]);
    expect(packet.entries.find((entry: { id: string }) => entry.id === "price:101")).toMatchObject({ amount: 34000, unit: "cái", tier: "retail" });
    expect(packet.catalogPage).toEqual({ total: 3, nextCursor: null, complete: true });
  });

  it("permits current dealer prices only for staff evidence and never retains a price for a missing variant", async () => {
    const evidence = await loadEvidenceBuilder();
    if (!evidence) return;
    const packet = evidence.buildEvidencePacket({
      role: "staff",
      now: new Date("2026-10-17T00:00:00.000Z"),
      variants: [{ id: 1, productId: 10, productName: "Tắc kê", variant: "6x50", category: "Vật tư", aliases: [], attributes: {}, active: true, verificationStatus: "verified", sourcePages: [] }],
      prices: [
        { id: 101, variantId: 1, packageId: 201, version: 3, amount: 34000, tier: "dealer", minimumQuantity: 1, packageName: "Bịch", packageQuantity: 10, unit: "cái", priceListName: "Sổ giá", supplierName: "Cửa hàng", currency: "VND", active: true, validFrom: "2026-10-01T00:00:00.000Z", validTo: null, isSample: false, supplierActive: true },
        { id: 102, variantId: 99, packageId: 202, version: 1, amount: 1, tier: "retail", minimumQuantity: 1, packageName: "Cái", packageQuantity: 1, unit: "cái", priceListName: "Sổ giá", supplierName: "Cửa hàng", currency: "VND", active: true, validFrom: "2026-10-01T00:00:00.000Z", validTo: null, isSample: false, supplierActive: true },
      ],
      documents: [],
    });

    expect(packet.entries.map((entry: { id: string }) => entry.id)).toEqual(["variant:1", "price:101"]);
    expect(packet.entries.find((entry: { id: string }) => entry.id === "price:101")).toMatchObject({ tier: "dealer" });
  });
});
