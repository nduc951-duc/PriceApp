import { describe, expect, it } from "vitest";
import { evaluateObservations, splitEvaluationCases } from "./evaluation.js";
import type { EvaluationCase, EvaluationObservation } from "./evaluation.js";

const adjudicatedCase = (overrides: Partial<EvaluationCase> = {}): EvaluationCase => ({
  id: "q1",
  sourceId: "source-1",
  questionFamilyId: "family-1",
  label: {
    status: "adjudicated",
    adjudicator: "reviewer-1",
    expectedOutcome: "answer",
    relevantVariantIds: [11],
    expectedVariantId: 11,
    expectedPackageId: "box-10",
    expectedTier: "retail",
    expectedAmount: 125,
    expectedCitationIds: ["chunk-1"],
  },
  ...overrides,
});

const observation = (overrides: Partial<EvaluationObservation> = {}): EvaluationObservation => ({
  caseId: "q1",
  retrievedVariantIds: [12, 11, 19],
  answer: {
    abstained: false,
    variantId: 11,
    packageId: "box-10",
    tier: "retail",
    amount: 125,
    citationIds: ["chunk-1"],
  },
  latencyMs: 100,
  ...overrides,
});

describe("splitEvaluationCases", () => {
  it("keeps connected source and question-family paraphrases in one deterministic split", () => {
    const cases = [
      adjudicatedCase({ id: "a", sourceId: "s1", questionFamilyId: "f1" }),
      adjudicatedCase({ id: "b", sourceId: "s1", questionFamilyId: "f2" }),
      adjudicatedCase({ id: "c", sourceId: "s2", questionFamilyId: "f2" }),
      adjudicatedCase({ id: "d", sourceId: "s3", questionFamilyId: "f3" }),
    ];

    const first = splitEvaluationCases(cases, { seed: "release-7", tuneFraction: 0.5 });
    const second = splitEvaluationCases([...cases].reverse(), { seed: "release-7", tuneFraction: 0.5 });
    expect(first).toEqual(second);
    expect(first.tune.map(({ id }) => id).sort()).toEqual(["a", "b", "c"]);
    expect(first.test.map(({ id }) => id)).toEqual(["d"]);
  });

  it("rejects duplicate case IDs instead of silently leaking or dropping rows", () => {
    expect(() => splitEvaluationCases([
      adjudicatedCase({ id: "same" }),
      adjudicatedCase({ id: "same", sourceId: "other" }),
    ], { seed: "seed", tuneFraction: 0.5 })).toThrow(/duplicate case id/i);
  });
});

describe("evaluateObservations", () => {
  it("measures intent accuracy and completeness across catalog-list pages", () => {
    const cases = [{
      id: "list-types",
      sourceId: "catalog-fixture",
      questionFamilyId: "all-types",
      label: {
        status: "adjudicated" as const,
        adjudicator: "reviewer-1",
        expectedOutcome: "answer" as const,
        relevantVariantIds: [21, 22],
        expectedIntent: "catalog_list" as const,
        expectedListVariantIds: [21, 22],
        expectedListTotal: 2,
      },
    }];
    const observations = [{
      caseId: "list-types",
      retrievedVariantIds: [21, 22],
      intent: "catalog_list" as const,
      listedVariantIds: [21, 22],
      listedTotal: 2,
      listingComplete: true,
      answer: { abstained: false },
      latencyMs: 75,
    }];

    const result = evaluateObservations(cases, observations);

    expect(result).toMatchObject({
      intentAccuracy: { correct: 1, total: 1, value: 1 },
      unitAccuracy: { correct: 0, total: 0, value: null },
      listPrecision: { correct: 2, total: 2, value: 1 },
      listRecall: { correct: 2, total: 2, value: 1 },
      listCompleteness: { correct: 1, total: 1, value: 1 },
      perIntent: [{
        intent: "catalog_list",
        scoredCases: 1,
        answerAccuracy: { correct: 1, total: 1, value: 1 },
      }],
    });
  });

  it("marks an apparently complete list incomplete when a matching variant is missing", () => {
    const cases = [{
      id: "list-types",
      sourceId: "catalog-fixture",
      questionFamilyId: "all-types",
      label: {
        status: "adjudicated" as const,
        adjudicator: "reviewer-1",
        expectedOutcome: "answer" as const,
        relevantVariantIds: [21, 22, 23],
        expectedIntent: "catalog_list" as const,
        expectedListVariantIds: [21, 22, 23],
        expectedListTotal: 3,
      },
    }];
    const observations = [{
      caseId: "list-types",
      retrievedVariantIds: [21, 22, 23],
      intent: "catalog_list" as const,
      listedVariantIds: [21, 22],
      listedTotal: 3,
      listingComplete: true,
      answer: { abstained: false },
      latencyMs: 75,
    }];

    const result = evaluateObservations(cases, observations);

    expect(result.listPrecision).toEqual({ correct: 2, total: 2, value: 1 });
    expect(result.listRecall).toEqual({ correct: 2, total: 3, value: 2 / 3 });
    expect(result.listCompleteness).toEqual({ correct: 0, total: 1, value: 0 });
  });

  it("scores the answer unit independently from amount and price tier", () => {
    const cases = [{
      id: "unit-price",
      sourceId: "price-fixture",
      questionFamilyId: "unit-price",
      label: {
        status: "adjudicated" as const,
        adjudicator: "reviewer-1",
        expectedOutcome: "answer" as const,
        relevantVariantIds: [31],
        expectedUnit: "cái",
      },
    }];
    const observations = [{
      caseId: "unit-price",
      retrievedVariantIds: [31],
      intent: "price_lookup" as const,
      answer: { abstained: false, unit: "bịch" },
      latencyMs: 80,
    }];

    const result = evaluateObservations(cases, observations);

    expect(result.unitAccuracy).toEqual({ correct: 0, total: 1, value: 0 });
  });

  it("scores only adjudicated observations and reports each requested metric", () => {
    const candidate: EvaluationCase = {
      id: "candidate",
      sourceId: "source-2",
      questionFamilyId: "family-2",
      label: { status: "candidate", rationale: "awaiting review" },
    };
    const result = evaluateObservations(
      [adjudicatedCase(), adjudicatedCase({
        id: "q2",
        label: {
          status: "adjudicated",
          adjudicator: "reviewer-1",
          expectedOutcome: "abstain",
          relevantVariantIds: [],
          expectedCitationIds: [],
        },
      }), candidate],
      [
        observation(),
        observation({
          caseId: "q2",
          retrievedVariantIds: [],
          answer: { abstained: true, citationIds: [] },
          latencyMs: 300,
        }),
        observation({ caseId: "candidate", latencyMs: 1 }),
      ],
    );

    expect(result).toEqual({
      scoredCases: 2,
      excludedUnlabeledCases: 1,
      recallAt5: { correct: 1, total: 1, value: 1 },
      mrr: { reciprocalRankSum: 0.5, total: 1, value: 0.5 },
      variantAccuracy: { correct: 1, total: 1, value: 1 },
      packageAccuracy: { correct: 1, total: 1, value: 1 },
      tierAccuracy: { correct: 1, total: 1, value: 1 },
      unitAccuracy: { correct: 0, total: 0, value: null },
      amountAccuracy: { correct: 1, total: 1, value: 1 },
      intentAccuracy: { correct: 0, total: 0, value: null },
      listPrecision: { correct: 0, total: 0, value: null },
      listRecall: { correct: 0, total: 0, value: null },
      listCompleteness: { correct: 0, total: 0, value: null },
      citationCorrectness: { correct: 2, total: 2, value: 1 },
      abstentionAccuracy: { correct: 2, total: 2, value: 1 },
      perIntent: [],
      latencyMs: { p50: 200, p95: 290 },
    });
  });

  it("uses null for undefined metrics and ignores observations without adjudicated labels", () => {
    const result = evaluateObservations(
      [{ ...adjudicatedCase(), label: { status: "candidate" } }],
      [observation()],
    );

    expect(result.scoredCases).toBe(0);
    expect(result.excludedUnlabeledCases).toBe(1);
    expect(result.recallAt5).toEqual({ correct: 0, total: 0, value: null });
    expect(result.mrr).toEqual({ reciprocalRankSum: 0, total: 0, value: null });
    expect(result.latencyMs).toEqual({ p50: null, p95: null });
    expect(result.perIntent).toEqual([]);
  });
});
