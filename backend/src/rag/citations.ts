export type CitationEvidenceKind = "approved_page_ocr" | "verified_catalog";

export type CitationSourceSpan = { start: number; end: number };

/** Evidence returned by retrieval before it has been checked for citation use. */
export type RetrievedChunkEvidence = {
  pageNumber?: number | null;
  chunkId?: number | null;
  chunkKey?: string | null;
  sourceRevision?: number | null;
  sourceSpan?: CitationSourceSpan | null;
  excerpt?: string | null;
  evidenceKind?: CitationEvidenceKind | null;
  verifiedVariantId?: number | null;
  verifiedPriceId?: number | null;
  /** Metadata is intentionally not used to fill citation evidence fields. */
  metadata?: Record<string, unknown>;
};

export type RagCitation = {
  pageNumber: number;
  chunkId: number;
  chunkKey: string;
  sourceRevision: number | null;
  sourceSpan: CitationSourceSpan | null;
  excerpt: string;
  evidenceKind: CitationEvidenceKind;
  verifiedVariantId?: number;
  verifiedPriceId?: number;
};

const isPositiveId = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isValidSpan = (span: CitationSourceSpan | null | undefined): span is CitationSourceSpan =>
  span !== null && span !== undefined
  && Number.isSafeInteger(span.start) && span.start >= 0
  && Number.isSafeInteger(span.end) && span.end > span.start;

/** Build citations only from explicit retrieved evidence with complete provenance. */
export function buildCitations(evidence: readonly RetrievedChunkEvidence[]): RagCitation[] {
  const citations: RagCitation[] = [];
  for (const item of evidence) {
    if (item.evidenceKind !== "approved_page_ocr" && item.evidenceKind !== "verified_catalog") continue;
    const isOcrEvidence = item.evidenceKind === "approved_page_ocr";
    const isCatalogEvidence = item.evidenceKind === "verified_catalog";
    if (!isPositiveId(item.pageNumber)
      || !isPositiveId(item.chunkId)
      || typeof item.chunkKey !== "string" || !item.chunkKey.trim()
      || typeof item.excerpt !== "string" || !item.excerpt.trim()
      || (isOcrEvidence && (!isPositiveId(item.sourceRevision) || !isValidSpan(item.sourceSpan)))
      || (isCatalogEvidence && item.sourceRevision !== null && item.sourceRevision !== undefined && !isPositiveId(item.sourceRevision))
      || (isCatalogEvidence && item.sourceSpan !== null && item.sourceSpan !== undefined && !isValidSpan(item.sourceSpan))
      || (item.verifiedVariantId !== undefined && item.verifiedVariantId !== null && !isPositiveId(item.verifiedVariantId))
      || (item.verifiedPriceId !== undefined && item.verifiedPriceId !== null && !isPositiveId(item.verifiedPriceId))) {
      continue;
    }

    const citation: RagCitation = {
      pageNumber: item.pageNumber,
      chunkId: item.chunkId,
      chunkKey: item.chunkKey,
      sourceRevision: isPositiveId(item.sourceRevision) ? item.sourceRevision : null,
      sourceSpan: isValidSpan(item.sourceSpan) ? { start: item.sourceSpan.start, end: item.sourceSpan.end } : null,
      excerpt: item.excerpt,
      evidenceKind: item.evidenceKind,
    };
    if (isPositiveId(item.verifiedVariantId)) citation.verifiedVariantId = item.verifiedVariantId;
    if (isPositiveId(item.verifiedPriceId)) citation.verifiedPriceId = item.verifiedPriceId;
    citations.push(citation);
  }
  return citations;
}
