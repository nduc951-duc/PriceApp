export type PriceTier = "retail" | "wholesale" | "dealer";

export interface QueryUnderstanding {
  rawQuery: string;
  nameTerms: string[];
  aliases: string[];
  dimensions: string[];
  specCodes: string[];
  material?: string;
  unit?: string;
  package?: string;
  quantity?: number;
  tier?: PriceTier;
  tierConflict: boolean;
}

export interface UnderstandQueryOptions {
  /** Maps known surface aliases to canonical product names; keys ignore case and Vietnamese diacritics. */
  aliases?: Record<string, string>;
}

/** Remove the requested catalog operation before interpreting product identity. */
export function catalogIdentityQuestion(question: string): string {
  return question.replace(/(?:thông\s+tin|thong\s+tin|quy\s+cách|quy\s+cach|kích\s+thước|kich\s+thuoc|đóng\s+gói|dong\s+goi|chất\s+liệu|chat\s+lieu|đơn\s+vị|don\s+vi)/giu, " ")
    .replace(/\s+(?:(?:thế|the)\s+nào|ra\s+sao|là\s+gì|la\s+gi|có\s+không|co\s+khong|được\s+không|duoc\s+khong)[?!.]*$/giu, " ")
    .replace(/\s+/gu, " ").trim();
}

export interface SpecificPriceLookupHint {
  productText: string;
  specifications: string[];
  material?: string;
  tier?: PriceTier;
  quantity?: number;
  unit?: string;
}

export type HardFilters = {
  dimensions?: string[];
  specCodes?: string[];
  material?: string;
  unit?: string;
  package?: string;
  tier?: PriceTier;
};

export type FilterableAttributes = Partial<HardFilters>;

type Offset = { start: number; end: number };
type NormalizedText = { value: string; offsets: Offset[] };
type Match = Offset & { normalized: string };

function normalizeWithOffsets(input: string): NormalizedText {
  let value = "";
  const offsets: Offset[] = [];
  let sourceIndex = 0;
  for (const character of input) {
    const start = sourceIndex;
    sourceIndex += character.length;
    const normalized = character
      .replace(/[đĐ]/g, (letter) => letter === "Đ" ? "D" : "d")
      .replace(/×/g, "x")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    for (const normalizedCharacter of normalized) {
      value += normalizedCharacter;
      offsets.push({ start, end: sourceIndex });
    }
  }
  return { value, offsets };
}

function collectMatches(text: NormalizedText, expression: RegExp): Match[] {
  const matches: Match[] = [];
  for (const match of text.value.matchAll(expression)) {
    if (match.index === undefined || !match[0]) continue;
    const startMap = text.offsets[match.index];
    const endMap = text.offsets[match.index + match[0].length - 1];
    if (startMap && endMap) matches.push({ start: startMap.start, end: endMap.end, normalized: match[0] });
  }
  return matches;
}

function sourceValue(input: string, match: Match): string {
  return input.slice(match.start, match.end).trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeWithOffsets(value).value.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function maskRanges(input: string, matches: Match[]): string {
  // Offsets are UTF-16 positions, matching split("") code units.
  const units = input.split("");
  for (const { start, end } of matches) {
    for (let index = start; index < end; index++) {
      if (!/\s/.test(units[index] ?? "")) units[index] = " ";
    }
  }
  return units.join("").replace(/\s+/g, " ").trim();
}

function normalizedPattern(value: string): string {
  return normalizeWithOffsets(value).value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

const STOP_WORDS = new Set([
  "bao", "gia", "cho", "minh", "toi", "hoi", "can", "mua", "lay", "loai", "nao", "nhung", "cac", "tung", "moi", "gi",
  "nhieu", "tien", "xin", "vui", "long", "voi", "la", "trang", "co", "thong", "tin",
  "ve", "san", "pham", "quy", "cach", "mat", "hang", "duoc", "tai", "o", "nay", "cua", "x",
]);
const UNIT_PATTERN = /\b(?:kg|g|met|m|cm|mm|lit|l|cai|con|tam|cay|bich|bo|cuon|hop|thung|goi)\b/gu;
const QUANTITY_PATTERN = /\b(?:mua|lay|can|so\s+luong)\s+(\d+(?:[.,]\d+)?)(?:\s*(kg|g|met|m|cm|mm|lit|l|cai|con|tam|cay|bich|bo|cuon|hop|thung|bao|goi))?\b/gu;

export function understandQuery(input: string, options: UnderstandQueryOptions = {}): QueryUnderstanding {
  const normalized = normalizeWithOffsets(input);
  const dimensionsFound = collectMatches(normalized, /\b\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?|ly|li|mm|cm|met|m)\b/gu);
  const codesFound = collectMatches(normalized, /\b(?:\d+[a-z]+\d*|[a-z]+\d+|\d{4,})\b/gu)
    .filter((code) => !dimensionsFound.some((dimension) => code.start < dimension.end && dimension.start < code.end));
  const materialFound = collectMatches(normalized, /\b(?:ma\s+kem|thep\s+khong\s+gi|inox|sat|thep|nhom|dong|nhua|cao\s+su)\b/gu);

  const tierPatterns: Array<[PriceTier, RegExp]> = [
    ["wholesale", /\b(?:gia\s+si|si|gia\s+buon|ban\s+buon|wholesale)\b/gu],
    ["dealer", /\b(?:gia\s+dai\s+ly|dai\s+ly|dealer)\b/gu],
    ["retail", /\b(?:gia\s+le|ban\s+le|retail)\b/gu],
  ];
  const tiersFound = new Set<PriceTier>();
  const tierMatches: Match[] = [];
  for (const [candidateTier, pattern] of tierPatterns) {
    const found = collectMatches(normalized, pattern);
    if (found.length) tiersFound.add(candidateTier);
    tierMatches.push(...found);
  }
  const tier = tiersFound.size === 1 ? [...tiersFound][0] : undefined;

  const packageFound = collectMatches(normalized, /\b(?:bich|bo|cuon|hop|thung|goi|cay|chai|can)(?:\s+\d+(?:[.,]\d+)?\s+(?:cai|con|cay|tam|goi|met))?\b/gu);
  const quantityFound = collectMatches(normalized, QUANTITY_PATTERN);
  const unitFound = collectMatches(normalized, UNIT_PATTERN);
  const quantityMatch = quantityFound[0];
  const quantityParts = [...normalized.value.matchAll(QUANTITY_PATTERN)][0];
  const quantity = quantityParts?.[1] ? Number(quantityParts[1].replace(",", ".")) : undefined;
  const quantityUnitMatch = quantityMatch
    ? unitFound.find((unitMatch) => unitMatch.start >= quantityMatch.start && unitMatch.end <= quantityMatch.end)
    : undefined;
  const standaloneUnitMatch = unitFound.find((unitMatch) =>
    !packageFound.some((packageMatch) => unitMatch.start < packageMatch.end && packageMatch.start < unitMatch.end)
    && !dimensionsFound.some((dimension) => unitMatch.start < dimension.end && dimension.start < unitMatch.end));
  const unit = quantityUnitMatch
    ? sourceValue(input, quantityUnitMatch)
    : standaloneUnitMatch ? sourceValue(input, standaloneUnitMatch) : undefined;

  const aliases: string[] = [];
  for (const [alias, canonical] of Object.entries(options.aliases ?? {})) {
    const pattern = new RegExp(`\\b${normalizedPattern(alias)}\\b`, "gu");
    if (collectMatches(normalized, pattern).length) aliases.push(canonical);
  }

  const allRanges = [...dimensionsFound, ...codesFound, ...materialFound, ...tierMatches, ...packageFound, ...quantityFound, ...unitFound];
  const residual = maskRanges(input, allRanges);
  const nameTerms = residual.match(/[\p{L}\p{N}]+/gu)?.filter((term) => {
    const termNormalized = normalizeWithOffsets(term).value;
    return !STOP_WORDS.has(termNormalized) && !/^\d+(?:[.,]\d+)?$/u.test(termNormalized);
  }) ?? [];

  return {
    rawQuery: input,
    nameTerms,
    aliases: unique(aliases),
    dimensions: unique(dimensionsFound.map((match) => sourceValue(input, match))),
    specCodes: unique(codesFound.map((match) => sourceValue(input, match))),
    ...(materialFound[0] ? { material: sourceValue(input, materialFound[0]) } : {}),
    ...(unit ? { unit } : {}),
    ...(packageFound[0] ? { package: sourceValue(input, packageFound[0]) } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(tier ? { tier } : {}),
    tierConflict: tiersFound.size > 1,
  };
}

/** Narrow fast-path hint; all other natural language is left for semantic planning. */
export function specificPriceLookupHint(input: string): SpecificPriceLookupHint | null {
  const parsed = understandQuery(input);
  const normalized = normalizeWithOffsets(input).value;
  const asksPrice = /\b(?:gia|bao\s+nhieu|bao\s+gia)\b/u.test(normalized);
  const asksForMore = /\b(?:so\s+sanh|doi\s+chieu|liet\s+ke|bao\s+nhieu\s+loai|loai\s+nao|(?:cac|tung|moi)\s+(?:quy\s+cach|loai)|quy\s+cach\s+nao|nen\s+chon|tu\s+van|va)\b/u.test(normalized);
  const specifications = [...parsed.dimensions, ...parsed.specCodes];
  const productText = [...parsed.aliases, ...parsed.nameTerms].join(" ").trim();
  if (!asksPrice || asksForMore || !productText || specifications.length !== 1 || parsed.tierConflict) return null;
  return {
    productText,
    specifications,
    ...(parsed.material ? { material: parsed.material } : {}),
    ...(parsed.tier ? { tier: parsed.tier } : {}),
    ...(parsed.quantity !== undefined ? { quantity: parsed.quantity } : {}),
    ...(parsed.unit ? { unit: parsed.unit } : {}),
  };
}

/** Carry prior product words into a clear follow-up without carrying old specs, tiers, or quantities. */
export function resolveFollowUpQuestion(previousQuestion: string | undefined, currentQuestion: string): string {
  if (!previousQuestion) return currentQuestion;
  const startsAsFollowUp = /^\s*còn\b/i.test(currentQuestion);
  const followUpText = startsAsFollowUp
    ? currentQuestion.replace(/^\s*còn\b\s*/i, "").replace(/^\s*(?:loại|quy\s+cách)\b\s*/i, "")
    : currentQuestion;
  const current = understandQuery(followUpText);
  const hasExplicitAttribute = current.dimensions.length > 0 || current.specCodes.length > 0 || current.material !== undefined
    || current.package !== undefined || current.unit !== undefined || current.tier !== undefined || current.quantity !== undefined;
  const attributeOnlyReply = current.nameTerms.length === 0 && current.aliases.length === 0 && hasExplicitAttribute;
  if (!startsAsFollowUp && !attributeOnlyReply) return currentQuestion;
  if (startsAsFollowUp && (current.nameTerms.length > 0 || current.aliases.length > 0)) return followUpText;
  const previous = understandQuery(previousQuestion);
  const productTerms = [...previous.aliases, ...previous.nameTerms];
  return productTerms.length > 0 ? `${productTerms.join(" ")} ${followUpText}`.trim() : followUpText;
}

export function toHardFilters(query: QueryUnderstanding): HardFilters {
  return {
    ...(query.dimensions.length ? { dimensions: query.dimensions } : {}),
    ...(query.specCodes.length ? { specCodes: query.specCodes } : {}),
    ...(query.material ? { material: query.material } : {}),
    ...(query.unit ? { unit: query.unit } : {}),
    ...(query.package ? { package: query.package } : {}),
    ...(query.tier ? { tier: query.tier } : {}),
  };
}

function scalarDimensionValue(value: string): string | null {
  const normalized = normalizeWithOffsets(value).value.replace(/\s+/gu, " ").trim();
  return normalized.match(/^(\d+(?:[.,]\d+)?)\s*(?:ly|li|mm|cm|m)$/u)?.[1]?.replace(",", ".") ?? null;
}

/** True when a measured value names one dimension of a composite catalog specification. */
export function isPartialDimension(value: string): boolean {
  return scalarDimensionValue(value) !== null;
}

function matchesDimension(requested: string, available: string[]): boolean {
  if (available.some((value) => sameText(value, requested))) return true;
  const scalar = scalarDimensionValue(requested);
  if (scalar === null) return false;
  return available.some((value) => {
    const normalized = normalizeWithOffsets(value).value.replace(/\s+/gu, " ").trim();
    const firstPart = normalized.match(/^(\d+(?:[.,]\d+)?)\s*x\s*\d/u)?.[1]?.replace(",", ".");
    return firstPart === scalar;
  });
}

function sameText(left: string, right: string): boolean {
  return normalizeWithOffsets(left).value.trim() === normalizeWithOffsets(right).value.trim();
}

export function matchesHardFilters(candidate: FilterableAttributes, query: QueryUnderstanding): boolean {
  const filters = toHardFilters(query);
  if (filters.dimensions && (!candidate.dimensions || filters.dimensions.some((value) => !matchesDimension(value, candidate.dimensions ?? [])))) return false;
  if (filters.specCodes && (!candidate.specCodes || filters.specCodes.some((value) => !candidate.specCodes?.some((item) => sameText(item, value))))) return false;
  if (filters.material && (!candidate.material || !sameText(candidate.material, filters.material))) return false;
  if (filters.unit && (!candidate.unit || !sameText(candidate.unit, filters.unit))) return false;
  if (filters.package && (!candidate.package || !sameText(candidate.package, filters.package))) return false;
  if (filters.tier && candidate.tier !== filters.tier) return false;
  return true;
}
