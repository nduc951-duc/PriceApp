import { matchesHardFilters, understandQuery, type PriceTier } from "./query-understanding.js";

export interface CatalogFilterCandidate {
  productName: string;
  variant: string;
  aliases?: string[];
  packages: Array<{ name: string; unit: string; activeTiers: PriceTier[] }>;
}

function normalizedTokens(value: string): string[] {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, (letter) => letter === "Đ" ? "D" : "d")
    .toLocaleLowerCase("vi").match(/[a-z0-9]+/g) ?? [];
}

/** Reject semantically unrelated retrieval candidates while retaining strong lexical typo matches. */
export function matchesNamedCandidate(
  candidate: Pick<CatalogFilterCandidate, "productName" | "variant" | "aliases">,
  question: string,
  lexicalRelevance = 0,
): boolean {
  const parsed = understandQuery(question);
  const terms = [...new Set([...parsed.nameTerms, ...parsed.aliases].flatMap(normalizedTokens))];
  if (!terms.length) return true;
  const productTokens = new Set(normalizedTokens([candidate.productName, ...(candidate.aliases ?? [])].join(" ")));
  const variantTokens = new Set(normalizedTokens(candidate.variant));
  const explicitVariantTerms = terms.filter((term) => !productTokens.has(term));
  if (explicitVariantTerms.some((term) => !variantTokens.has(term))) return false;
  const candidateTokens = new Set(normalizedTokens([candidate.productName, candidate.variant, ...(candidate.aliases ?? [])].join(" ")));
  const overlap = terms.filter((term) => candidateTokens.has(term)).length;
  const requiredOverlap = terms.length <= 2 ? 1 : Math.ceil(terms.length / 2);
  return overlap >= requiredOverlap || lexicalRelevance >= 18;
}

/** Return explicitly named comparison targets; otherwise this is an ordinary single-target question. */
export function comparisonTargets(question: string): string[] | null {
  if (!/(?:so\s+sánh|so\s+với|đối\s+chiếu)/i.test(question)) return null;
  const body = question
    .replace(/^\s*(?:hãy\s*)?so\s+sánh\s+(?:giá\s+)?/i, "")
    .replace(/^\s*đối\s+chiếu\s+(?:giá\s+)?/i, "")
    .replace(/\s+(?:giá|giúp\s+tôi|giúp\s+mình)\s*\??\s*$/i, "")
    .trim();
  const targets = body.split(/\s+(?:với|vs\.?|và)\s+/i).map((part) => part.trim()).filter(Boolean);
  if (targets.length < 2) return null;
  const sharedProductTerms = understandQuery(targets[0] ?? "").nameTerms;
  return targets.map((target, index) => {
    if (index === 0 || understandQuery(target).nameTerms.length > 0 || sharedProductTerms.length === 0) return target;
    return `${sharedProductTerms.join(" ")} ${target}`;
  });
}

/** Match only attributes stated explicitly in the question and represented by the candidate. */
export function matchesExplicitQuery(candidate: CatalogFilterCandidate, question: string): boolean {
  const parsedQuestion = understandQuery(question);
  const parsedCandidate = understandQuery(`${candidate.productName} ${candidate.variant}`);
  const explicitTier = parsedQuestion.tier;
  const baseMatches = matchesHardFilters({
    dimensions: parsedCandidate.dimensions,
    specCodes: parsedCandidate.specCodes,
    material: parsedCandidate.material,
  }, { ...parsedQuestion, package: undefined, unit: undefined, tier: undefined });
  if (!baseMatches) return false;

  if (!parsedQuestion.package && !parsedQuestion.unit && !explicitTier) return true;
  return candidate.packages.some((pack) => matchesExplicitPackage(pack, question));
}

export function matchesExplicitPackage(
  candidate: CatalogFilterCandidate["packages"][number],
  question: string,
): boolean {
  const parsedQuestion = understandQuery(question);
  const explicitUnit = parsedQuestion.package ? undefined : parsedQuestion.unit;
  return matchesHardFilters({
    package: candidate.name,
    unit: candidate.unit,
    ...(parsedQuestion.tier ? { tier: candidate.activeTiers.includes(parsedQuestion.tier) ? parsedQuestion.tier : undefined } : {}),
  }, { ...parsedQuestion, dimensions: [], specCodes: [], material: undefined, unit: explicitUnit });
}
