import { z } from "zod";
import type { EvidencePacket } from "./evidence.js";

const evidenceIds = z.array(z.string().regex(/^(variant|price|chunk):[1-9]\d*$/)).max(16);
const variantIds = z.array(z.number().int().positive()).max(12);
const narrativeBlock = z.strictObject({
  kind: z.literal("narrative"),
  text: z.string().trim().min(1).max(600),
  evidenceIds: evidenceIds.min(1),
});
const clarificationBlock = z.strictObject({
  kind: z.literal("clarification"),
  text: z.string().trim().min(1).max(400),
  unresolvedFields: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  evidenceIds: evidenceIds.default([]),
});
const comparisonBlock = z.strictObject({
  kind: z.literal("comparison"),
  text: z.string().trim().min(1).max(600),
  variantIds: variantIds.min(2).max(8),
  evidenceIds: evidenceIds.min(2),
});
const recommendationBlock = z.strictObject({
  kind: z.literal("recommendation"),
  text: z.string().trim().min(1).max(600),
  variantIds: variantIds.min(1).max(8),
  evidenceIds: evidenceIds.min(1),
});

export const groundedResponseSchema = z.strictObject({
  blocks: z.array(z.discriminatedUnion("kind", [narrativeBlock, clarificationBlock, comparisonBlock, recommendationBlock])).min(1).max(6),
});
export type GroundedResponse = z.infer<typeof groundedResponseSchema>;

export type GroundedResponseRejection =
  | "invalid_json"
  | "invalid_schema"
  | "unknown_evidence"
  | "unknown_variant"
  | "unsupported_authoritative_value"
  | "unsupported_completeness_claim"
  | "missing_fact_evidence";
export type GroundedResponseValidation =
  | { valid: true; blocks: GroundedResponse["blocks"] }
  | { valid: false; reason: GroundedResponseRejection };

export interface GroundedResponseRequirements {
  requiredDocumentTerms?: string[];
}

const adviceStopWords = new Set(["cho", "va", "voi", "de", "la", "co", "can", "dung", "su", "phu", "hop", "lap", "tai", "trong", "ngoai"]);

function normalizedTerms(value: string) {
  return value.toLocaleLowerCase("vi-VN").normalize("NFD").replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 3 && !adviceStopWords.has(term));
}

// JavaScript \b only recognizes ASCII word characters, so it misses words such
// as “giá”, “đồng”, and “tất cả” at Vietnamese word boundaries.
const authoritativeValuePattern = /(?:₫|(?<![\p{L}\p{N}])(?:vnd|đồng|giá|price|trang|page|nguồn|source)(?![\p{L}\p{N}])|https?:\/\/)/iu;
const completenessClaimPattern = /(?<![\p{L}\p{N}])(?:tất cả|toàn bộ|đầy đủ|mọi quy cách|mọi loại|danh sách hoàn chỉnh|tat ca|toan bo|day du|moi quy cach|moi loai)(?![\p{L}\p{N}])/iu;

function parseModelResponse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function blockText(block: GroundedResponse["blocks"][number]) {
  return block.text.normalize("NFC");
}

export function validateGroundedResponse(raw: string, packet: EvidencePacket, requirements: GroundedResponseRequirements = {}): GroundedResponseValidation {
  const parsed = parseModelResponse(raw);
  if (parsed === null) return { valid: false, reason: "invalid_json" };
  const schema = groundedResponseSchema.safeParse(parsed);
  if (!schema.success) return { valid: false, reason: "invalid_schema" };

  const evidenceById = new Map<string, EvidencePacket["entries"][number]>(packet.entries.map((entry) => [entry.id, entry]));
  const catalogVariantIds = new Set(packet.entries.filter((entry) => entry.kind === "catalog").map((entry) => entry.variantId));
  for (const block of schema.data.blocks) {
    if (block.evidenceIds.some((id) => !evidenceById.has(id))) return { valid: false, reason: "unknown_evidence" };
    const citedVariants = new Set(block.evidenceIds.flatMap((id) => {
      const entry = evidenceById.get(id);
      return entry?.kind === "catalog" ? [entry.variantId] : [];
    }));
    const citedDocumentVariants = new Set(block.evidenceIds.flatMap((id) => {
      const entry = evidenceById.get(id);
      return entry?.kind === "document" && entry.variantId !== null ? [entry.variantId] : [];
    }));
    if (block.kind !== "clarification" && citedDocumentVariants.size === 0) {
      return { valid: false, reason: "missing_fact_evidence" };
    }
    if ("variantIds" in block) {
      if (block.variantIds.some((id) => !catalogVariantIds.has(id))) return { valid: false, reason: "unknown_variant" };
      if (block.variantIds.some((id) => !citedVariants.has(id))) return { valid: false, reason: "unknown_variant" };
      if (block.kind === "comparison" && new Set(block.variantIds).size < 2) return { valid: false, reason: "unknown_variant" };
      if (block.variantIds.some((id) => !citedDocumentVariants.has(id))) return { valid: false, reason: "missing_fact_evidence" };
      if ((block.kind === "recommendation" || block.kind === "comparison") && requirements.requiredDocumentTerms?.length) {
        const requiredTerms = [...new Set(requirements.requiredDocumentTerms.flatMap(normalizedTerms))];
        for (const variantId of block.variantIds) {
          const citedDocs = block.evidenceIds.map((id) => evidenceById.get(id))
            .filter((entry) => entry?.kind === "document" && entry.variantId === variantId);
          const supportedTerms = new Set(citedDocs.flatMap((entry) => entry?.kind === "document" ? normalizedTerms(entry.excerpt) : []));
          if (!requiredTerms.length || requiredTerms.some((term) => !supportedTerms.has(term))) {
            return { valid: false, reason: "missing_fact_evidence" };
          }
        }
      }
    }
    if (authoritativeValuePattern.test(blockText(block))) return { valid: false, reason: "unsupported_authoritative_value" };
    // Numeric facts must be copied as whole clauses from cited catalog evidence.
    // Checking complete clauses prevents swapping two individually valid dimensions.
    const normalize = (value: string) => value.normalize("NFC").toLocaleLowerCase("vi-VN").replace(/\s+/gu, " ").trim();
    const factSources = block.evidenceIds.flatMap((id) => {
      const entry = evidenceById.get(id);
      return entry?.kind === "document" ? [normalize(entry.excerpt)] : entry?.kind === "catalog"
        ? [normalize(`${entry.productName}; ${entry.variant}; ${JSON.stringify(entry.attributes ?? {})}`)] : [];
    });
    const numericalClauses = block.text.split(/[;\n]|(?<!\d)[.!?]|[.!?](?!\d)/u).map(normalize).filter((value) => /\d/u.test(value));
    if (numericalClauses.some((clause) => !factSources.some((source) => source.includes(clause)))) {
      return { valid: false, reason: "unsupported_authoritative_value" };
    }
    if (completenessClaimPattern.test(blockText(block)) && packet.catalogPage?.complete !== true) {
      return { valid: false, reason: "unsupported_completeness_claim" };
    }
    const mentionedProductIdentity = packet.entries.some((entry) => entry.kind === "catalog"
      && (block.text.includes(entry.productName) || (entry.variant.length >= 2 && block.text.includes(entry.variant)))
      && !citedVariants.has(entry.variantId));
    if (mentionedProductIdentity) return { valid: false, reason: "unknown_variant" };
  }
  return { valid: true, blocks: schema.data.blocks };
}

export function hasRequiredResponseKinds(
  blocks: GroundedResponse["blocks"],
  requiredKinds: Array<"comparison" | "recommendation">,
) {
  return requiredKinds.every((kind) => blocks.some((block) => block.kind === kind));
}
