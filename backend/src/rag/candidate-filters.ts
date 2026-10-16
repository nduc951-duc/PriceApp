import { matchesHardFilters, understandQuery, type PriceTier } from "./query-understanding.js";

export interface CatalogFilterCandidate {
  productName: string;
  variant: string;
  packages: Array<{ name: string; unit: string; activeTiers: PriceTier[] }>;
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
