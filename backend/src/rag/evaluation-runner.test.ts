import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildEvaluationReport,
  parseEvaluationCliArgs,
  parseEvaluationInputs,
  runEvaluationFiles,
} from "./evaluation-runner.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function makeDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rag-evaluation-")).then((directory) => {
    tempDirectories.push(directory);
    return directory;
  });
}

describe("evaluation runner inputs and options", () => {
  it("parses supplied candidate and adjudicated labels and rejects malformed JSON", () => {
    const parsed = parseEvaluationInputs(
      JSON.stringify([
        { id: "reviewed", sourceId: "source-a", questionFamilyId: "family-a", label: {
          status: "adjudicated", adjudicator: "reviewer", expectedOutcome: "answer", relevantVariantIds: [4],
        } },
        { id: "pending", sourceId: "source-b", questionFamilyId: "family-b", label: { status: "candidate" } },
      ]),
      JSON.stringify([{ caseId: "reviewed", retrievedVariantIds: [4], answer: { abstained: false }, latencyMs: 25 }]),
    );

    expect(parsed.cases.map(({ label }) => label?.status)).toEqual(["adjudicated", "candidate"]);
    expect(() => parseEvaluationInputs("{", "[]")).toThrow("cases file is not valid JSON");
    expect(() => parseEvaluationInputs("[]", '[{"caseId":"x"}]')).toThrow(/invalid observations data/);
  });

  it("keeps the question and intent on candidate cases without treating them as adjudicated", () => {
    const parsed = parseEvaluationInputs(
      JSON.stringify([{
        id: "list-fasteners",
        question: "Cửa hàng có những loại tắc kê đạn nào?",
        intent: "catalog_list",
        sourceId: "candidate-corpus",
        questionFamilyId: "fastener-list",
        label: { status: "candidate" },
      }]),
      "[]",
    );

    expect(parsed.cases[0]).toMatchObject({
      question: "Cửa hàng có những loại tắc kê đạn nào?",
      intent: "catalog_list",
      label: { status: "candidate" },
    });
    expect(buildEvaluationReport(parsed).metrics?.scoredCases).toBe(0);
  });

  it("prints repeatable CLI usage without requiring observations or writing a report", () => {
    const entry = fileURLToPath(new URL("./evaluation-runner.ts", import.meta.url));
    const result = spawnSync(process.execPath, ["--import", "tsx", entry, "--help"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--observations");
    expect(result.stderr).toBe("");
  });

  it("loads the versioned assistant cases as candidates without inventing ground truth", async () => {
    const casesPath = fileURLToPath(new URL("../../testdata/rag-assistant-cases.json", import.meta.url));
    const parsed = parseEvaluationInputs(await readFile(casesPath, "utf8"), "[]");
    const intents = new Set(parsed.cases.map(({ intent }) => intent));

    expect(parsed.cases).toHaveLength(17);
    expect(intents).toEqual(new Set([
      "price_lookup", "catalog_list", "product_info", "advice", "comparison",
      "multi_intent", "out_of_domain", "clarification",
    ]));
    expect(parsed.cases.every(({ label }) => label?.status === "candidate")).toBe(true);
    expect(buildEvaluationReport(parsed).metrics?.scoredCases).toBe(0);
  });

  it("requires seed and fraction together and validates deterministic split options", () => {
    const common = ["--cases", "cases.json", "--observations", "runs.json", "--output", "report.json"];
    expect(() => parseEvaluationCliArgs([...common, "--seed", "run-1"])).toThrow(/provided together/);
    expect(() => parseEvaluationCliArgs([...common, "--seed", "run-1", "--tune-fraction", "1"])).toThrow(/greater than 0 and less than 1/);
    expect(parseEvaluationCliArgs([...common, "--seed", "run-1", "--tune-fraction", "0.7"])).toMatchObject({
      split: { seed: "run-1", tuneFraction: 0.7 },
    });
  });
});

describe("evaluation runner report", () => {
  it("exports distinct tune and held-out test metrics while excluding candidate labels", () => {
    const inputs = parseEvaluationInputs(
      JSON.stringify([
        { id: "reviewed", sourceId: "source-a", questionFamilyId: "family-a", label: {
          status: "adjudicated", adjudicator: "reviewer", expectedOutcome: "answer", relevantVariantIds: [4],
          expectedVariantId: 4,
        } },
        { id: "pending", sourceId: "source-b", questionFamilyId: "family-b", label: { status: "candidate" } },
      ]),
      JSON.stringify([
        { caseId: "reviewed", retrievedVariantIds: [4], answer: { abstained: false, variantId: 4 }, latencyMs: 25 },
        { caseId: "pending", retrievedVariantIds: [9], answer: { abstained: false }, latencyMs: 40 },
      ]),
    );

    const report = buildEvaluationReport(inputs, { seed: "release-1", tuneFraction: 0.5 });
    expect(report.metrics).toBeUndefined();
    expect(report.split?.seed).toBe("release-1");
    expect(report.split!.tuneCaseIds).toHaveLength(1);
    expect(report.split!.testCaseIds).toHaveLength(1);
    expect(new Set([...report.split!.tuneCaseIds, ...report.split!.testCaseIds])).toEqual(new Set(["reviewed", "pending"]));
    expect(report.split!.tuneCaseIds.some((id) => report.split!.testCaseIds.includes(id))).toBe(false);
    expect(report.split!.tune.scoredCases + report.split!.test.scoredCases).toBe(1);
    expect(report.split!.tune.excludedUnlabeledCases + report.split!.test.excludedUnlabeledCases).toBe(1);
  });

  it("reads input files and writes a re-loadable JSON report", async () => {
    const directory = await makeDirectory();
    const casesPath = join(directory, "cases.json");
    const observationsPath = join(directory, "observations.json");
    const outputPath = join(directory, "report.json");
    await writeFile(casesPath, "[]", "utf8");
    await writeFile(observationsPath, "[]", "utf8");

    const result = await runEvaluationFiles({ casesPath, observationsPath, outputPath });
    const saved = JSON.parse(await readFile(outputPath, "utf8"));
    expect(saved).toEqual(result);
    expect(saved.metrics.scoredCases).toBe(0);
    expect(saved.metrics.recallAt5.value).toBeNull();
  });
});
