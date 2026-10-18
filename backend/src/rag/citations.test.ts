import { describe, expect, it } from "vitest";
import { buildCitations, type RetrievedChunkEvidence } from "./citations.js";

const evidence = (overrides: Partial<RetrievedChunkEvidence> = {}): RetrievedChunkEvidence => ({
  pageNumber: 4,
  chunkId: 11,
  chunkKey: "variant:21:0",
  sourceRevision: null,
  sourceSpan: null,
  excerpt: "Vật tư đã xác minh trong catalog.",
  evidenceKind: "verified_catalog",
  verifiedVariantId: 21,
  ...overrides,
});

describe("buildCitations", () => {
  it("keeps separate catalog chunks and their verified variant IDs", () => {
    expect(buildCitations([evidence(), evidence({ chunkId: 12, chunkKey: "variant:21:1" })])).toEqual([
      {
        pageNumber: 4, chunkId: 11, chunkKey: "variant:21:0", sourceRevision: null,
        sourceSpan: null, excerpt: "Vật tư đã xác minh trong catalog.", evidenceKind: "verified_catalog", verifiedVariantId: 21,
      },
      {
        pageNumber: 4, chunkId: 12, chunkKey: "variant:21:1", sourceRevision: null,
        sourceSpan: null, excerpt: "Vật tư đã xác minh trong catalog.", evidenceKind: "verified_catalog", verifiedVariantId: 21,
      },
    ]);
  });

  it("allows catalog citations without scanned pages", () => {
    expect(buildCitations([evidence({ pageNumber: null })])).toEqual([{
      pageNumber: null, chunkId: 11, chunkKey: "variant:21:0", sourceRevision: null,
      sourceSpan: null, excerpt: "Vật tư đã xác minh trong catalog.", evidenceKind: "verified_catalog", verifiedVariantId: 21,
    }]);
  });

  it("omits incomplete or invalid provenance without inferring it from metadata", () => {
    const missingVariant = evidence({ pageNumber: null, verifiedVariantId: null });
    const invalidSpan = evidence({ sourceSpan: { start: 43, end: 20 } });
    const invalidId = evidence({ chunkId: 0 });
    const missingPageAndMetadata = evidence({ pageNumber: undefined, verifiedVariantId: null, metadata: { page_number: 4, product_variant_id: 21 } });
    expect(buildCitations([missingVariant, invalidSpan, invalidId, missingPageAndMetadata])).toEqual([]);
  });

  it("rejects historical OCR evidence", () => {
    expect(buildCitations([evidence({ evidenceKind: "approved_page_ocr" as "verified_catalog" })])).toEqual([]);
  });
});
