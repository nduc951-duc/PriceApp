import { describe, expect, it } from "vitest";
import { buildCitations, type RetrievedChunkEvidence } from "./citations.js";

const evidence = (overrides: Partial<RetrievedChunkEvidence> = {}): RetrievedChunkEvidence => ({
  pageNumber: 4,
  chunkId: 11,
  chunkKey: "page:9:ocr:0",
  sourceRevision: 3,
  sourceSpan: { start: 20, end: 43 },
  excerpt: "Price by approved package.",
  evidenceKind: "approved_page_ocr",
  ...overrides,
});

describe("buildCitations", () => {
  it("preserves separate retrieved chunks even when they refer to the same page", () => {
    const first = evidence();
    const second = evidence({ chunkId: 12, chunkKey: "page:9:ocr:1", sourceSpan: { start: 40, end: 61 }, excerpt: "Price by another package." });

    expect(buildCitations([first, second])).toEqual([
      {
        pageNumber: 4, chunkId: 11, chunkKey: "page:9:ocr:0", sourceRevision: 3,
        sourceSpan: { start: 20, end: 43 }, excerpt: "Price by approved package.", evidenceKind: "approved_page_ocr",
      },
      {
        pageNumber: 4, chunkId: 12, chunkKey: "page:9:ocr:1", sourceRevision: 3,
        sourceSpan: { start: 40, end: 61 }, excerpt: "Price by another package.", evidenceKind: "approved_page_ocr",
      },
    ]);
  });

  it("omits evidence that lacks required fields instead of inferring them from metadata", () => {
    const missingPage = evidence({ pageNumber: undefined, metadata: { page_number: 4 } });
    const missingRevision = evidence({ sourceRevision: undefined, metadata: { source_revision: 3 } });

    expect(buildCitations([missingPage, missingRevision])).toEqual([]);
  });

  it("rejects invalid spans and IDs and copies only explicit verified IDs", () => {
    const citation = evidence({ verifiedVariantId: 21, verifiedPriceId: 34 });
    const invalidSpan = evidence({ sourceSpan: { start: 43, end: 20 } });
    const invalidId = evidence({ chunkId: 0 });
    const invalidOptionalId = evidence({ verifiedVariantId: -2 });

    expect(buildCitations([citation, invalidSpan, invalidId, invalidOptionalId])).toEqual([
      {
        pageNumber: 4, chunkId: 11, chunkKey: "page:9:ocr:0", sourceRevision: 3,
        sourceSpan: { start: 20, end: 43 }, excerpt: "Price by approved package.", evidenceKind: "approved_page_ocr",
        verifiedVariantId: 21, verifiedPriceId: 34,
      },
    ]);
  });

  it("keeps verified catalog evidence when OCR revision offsets do not apply", () => {
    expect(buildCitations([evidence({
      chunkKey: "page:9:variant:21:0", sourceRevision: null, sourceSpan: null,
      evidenceKind: "verified_catalog", verifiedVariantId: 21,
    })])).toEqual([{
      pageNumber: 4, chunkId: 11, chunkKey: "page:9:variant:21:0", sourceRevision: null,
      sourceSpan: null, excerpt: "Price by approved package.", evidenceKind: "verified_catalog", verifiedVariantId: 21,
    }]);
  });
});
