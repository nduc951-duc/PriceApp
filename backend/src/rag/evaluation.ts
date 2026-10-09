export interface EvaluationCase {
  id: string;
  sourceId: string;
  questionFamilyId: string;
  label?: CandidateLabel | AdjudicatedLabel;
}

export interface CandidateLabel {
  status: "candidate";
  rationale?: string;
}

export interface AdjudicatedLabel {
  status: "adjudicated";
  adjudicator: string;
  expectedOutcome: "answer" | "abstain";
  relevantVariantIds: number[];
  expectedVariantId?: number;
  expectedPackageId?: string;
  expectedTier?: string;
  expectedAmount?: number;
  expectedCitationIds?: string[];
}

export interface EvaluationObservation {
  caseId: string;
  retrievedVariantIds: number[];
  answer?: {
    abstained: boolean;
    variantId?: number;
    packageId?: string;
    tier?: string;
    amount?: number;
    citationIds?: string[];
  };
  latencyMs: number;
}

export interface EvaluationSplit {
  tune: EvaluationCase[];
  test: EvaluationCase[];
}

export interface AccuracyMetric {
  correct: number;
  total: number;
  value: number | null;
}

export interface EvaluationMetrics {
  scoredCases: number;
  excludedUnlabeledCases: number;
  recallAt5: AccuracyMetric;
  mrr: { reciprocalRankSum: number; total: number; value: number | null };
  variantAccuracy: AccuracyMetric;
  packageAccuracy: AccuracyMetric;
  tierAccuracy: AccuracyMetric;
  amountAccuracy: AccuracyMetric;
  citationCorrectness: AccuracyMetric;
  /** Exact agreement with the adjudicated answer-or-abstain expectation. */
  abstentionAccuracy: AccuracyMetric;
  latencyMs: { p50: number | null; p95: number | null };
}

export function splitEvaluationCases(
  cases: EvaluationCase[],
  options: { seed: string; tuneFraction: number },
): EvaluationSplit {
  if (!options.seed) throw new Error("seed must be non-empty");
  if (!(options.tuneFraction > 0 && options.tuneFraction < 1)) {
    throw new Error("tuneFraction must be between 0 and 1");
  }
  assertUnique(cases.map(({ id }) => id), "case ID");

  const sets = new DisjointSet();
  for (const item of cases) {
    if (!item.id || !item.sourceId || !item.questionFamilyId) {
      throw new Error("case id, sourceId and questionFamilyId must be non-empty");
    }
    const source = `source:${item.sourceId}`;
    const family = `family:${item.questionFamilyId}`;
    sets.union(source, family);
  }

  const groups = new Map<string, EvaluationCase[]>();
  for (const item of cases) {
    const groupKey = sets.find(`source:${item.sourceId}`);
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }
  if (groups.size < 2) {
    throw new Error("at least two independent source/question-family groups are required for a tune/test split");
  }

  const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
    const hashA = stableHash(`${options.seed}:${a}`);
    const hashB = stableHash(`${options.seed}:${b}`);
    return hashA - hashB || a.localeCompare(b);
  });
  const target = cases.length * options.tuneFraction;
  const tune: EvaluationCase[] = [];
  const test: EvaluationCase[] = [];
  for (let index = 0; index < orderedGroups.length; index += 1) {
    const [, group] = orderedGroups[index]!;
    if (index < orderedGroups.length - 1 && tune.length < target) tune.push(...group);
    else test.push(...group);
  }
  return { tune: stableCaseOrder(tune), test: stableCaseOrder(test) };
}

export function evaluateObservations(
  cases: EvaluationCase[],
  observations: EvaluationObservation[],
): EvaluationMetrics {
  assertUnique(cases.map(({ id }) => id), "case ID");
  assertUnique(observations.map(({ caseId }) => caseId), "observation case ID");

  const observationsById = new Map(observations.map((item) => [item.caseId, item]));
  const adjudicated = cases.filter((item): item is EvaluationCase & { label: AdjudicatedLabel } =>
    item.label?.status === "adjudicated" && observationsById.has(item.id));
  const scored = adjudicated.map((item) => ({ item, observation: observationsById.get(item.id)! }));

  const recallHits: boolean[] = [];
  const reciprocalRanks: number[] = [];
  const variant: boolean[] = [];
  const packages: boolean[] = [];
  const tiers: boolean[] = [];
  const amounts: boolean[] = [];
  const citations: boolean[] = [];
  const abstentions: boolean[] = [];
  const latencies: number[] = [];

  for (const { item, observation } of scored) {
    const label = item.label;
    const retrievedTop5 = observation.retrievedVariantIds.slice(0, 5);
    if (label.relevantVariantIds.length > 0) {
      const relevant = new Set(label.relevantVariantIds);
      recallHits.push(retrievedTop5.some((id) => relevant.has(id)));
      const rank = observation.retrievedVariantIds.findIndex((id) => relevant.has(id));
      if (rank >= 0) reciprocalRanks.push(1 / (rank + 1));
      else reciprocalRanks.push(0);
    }
    if (label.expectedVariantId !== undefined) variant.push(observation.answer?.variantId === label.expectedVariantId);
    if (label.expectedPackageId !== undefined) packages.push(observation.answer?.packageId === label.expectedPackageId);
    if (label.expectedTier !== undefined) tiers.push(observation.answer?.tier === label.expectedTier);
    if (label.expectedAmount !== undefined) amounts.push(observation.answer?.amount === label.expectedAmount);
    if (label.expectedCitationIds !== undefined) {
      citations.push(sameStringSet(observation.answer?.citationIds ?? [], label.expectedCitationIds));
    }
    abstentions.push((observation.answer?.abstained ?? false) === (label.expectedOutcome === "abstain"));
    if (Number.isFinite(observation.latencyMs) && observation.latencyMs >= 0) latencies.push(observation.latencyMs);
  }

  return {
    scoredCases: scored.length,
    excludedUnlabeledCases: cases.filter((item) => item.label?.status !== "adjudicated").length,
    recallAt5: accuracy(recallHits),
    mrr: meanMetric(reciprocalRanks),
    variantAccuracy: accuracy(variant),
    packageAccuracy: accuracy(packages),
    tierAccuracy: accuracy(tiers),
    amountAccuracy: accuracy(amounts),
    citationCorrectness: accuracy(citations),
    abstentionAccuracy: accuracy(abstentions),
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
  };
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  find(value: string): string {
    const parent = this.parent.get(value);
    if (!parent) {
      this.parent.set(value, value);
      return value;
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      const [first, second] = leftRoot.localeCompare(rightRoot) <= 0 ? [leftRoot, rightRoot] : [rightRoot, leftRoot];
      this.parent.set(second, first);
    }
  }
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stableCaseOrder(items: EvaluationCase[]): EvaluationCase[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function assertUnique(values: string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${name}`);
}

function accuracy(values: boolean[]): AccuracyMetric {
  const correct = values.filter(Boolean).length;
  return { correct, total: values.length, value: values.length === 0 ? null : correct / values.length };
}

function meanMetric(values: number[]): { reciprocalRankSum: number; total: number; value: number | null } {
  const reciprocalRankSum = values.reduce((sum, value) => sum + value, 0);
  return { reciprocalRankSum, total: values.length, value: values.length === 0 ? null : reciprocalRankSum / values.length };
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const fraction = position - lowerIndex;
  const lower = sorted[lowerIndex]!;
  const upper = sorted[Math.min(lowerIndex + 1, sorted.length - 1)]!;
  return lower + (upper - lower) * fraction;
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = [...new Set(left)].sort();
  const rightSet = [...new Set(right)].sort();
  return leftSet.length === rightSet.length && leftSet.every((value, index) => value === rightSet[index]);
}
