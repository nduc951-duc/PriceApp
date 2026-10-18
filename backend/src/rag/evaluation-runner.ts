import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  evaluateObservations,
  splitEvaluationCases,
  type EvaluationCase,
  evaluationIntents,
  type EvaluationMetrics,
  type EvaluationObservation,
} from "./evaluation.js";

const labelSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("candidate"), rationale: z.string().optional() }).strict(),
  z.object({
    status: z.literal("adjudicated"),
    adjudicator: z.string().min(1),
    expectedOutcome: z.enum(["answer", "abstain"]),
    expectedIntent: z.enum(evaluationIntents).optional(),
    relevantVariantIds: z.array(z.number().int().positive()),
    expectedVariantId: z.number().int().positive().optional(),
    expectedPackageId: z.string().optional(),
    expectedTier: z.string().optional(),
    expectedAmount: z.number().finite().optional(),
    expectedUnit: z.string().optional(),
    expectedCitationIds: z.array(z.string()).optional(),
    expectedListVariantIds: z.array(z.number().int().positive()).optional(),
    expectedListTotal: z.number().int().nonnegative().optional(),
  }).strict(),
]);

const casesSchema = z.array(z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(1000).optional(),
  intent: z.enum(evaluationIntents).optional(),
  sourceId: z.string().min(1),
  questionFamilyId: z.string().min(1),
  label: labelSchema.optional(),
}).strict());

const observationsSchema = z.array(z.object({
  caseId: z.string().min(1),
  retrievedVariantIds: z.array(z.number().int().positive()),
  intent: z.enum(evaluationIntents).optional(),
  listedVariantIds: z.array(z.number().int().positive()).optional(),
  listedTotal: z.number().int().nonnegative().optional(),
  listingComplete: z.boolean().optional(),
  answer: z.object({
    abstained: z.boolean(),
    variantId: z.number().int().positive().optional(),
    packageId: z.string().optional(),
    tier: z.string().optional(),
    amount: z.number().finite().optional(),
    unit: z.string().optional(),
    citationIds: z.array(z.string()).optional(),
  }).strict().optional(),
  latencyMs: z.number().finite().nonnegative(),
}).strict());

export interface EvaluationInputs {
  cases: EvaluationCase[];
  observations: EvaluationObservation[];
}

export interface EvaluationReport {
  schemaVersion: 1;
  caseCount: number;
  observationCount: number;
  casesWithoutObservation: number;
  metrics?: EvaluationMetrics;
  split?: {
    seed: string;
    tuneFraction: number;
    tuneCaseIds: string[];
    testCaseIds: string[];
    tune: EvaluationMetrics;
    test: EvaluationMetrics;
  };
}

export interface SplitOptions {
  seed: string;
  tuneFraction: number;
}

export function parseEvaluationInputs(casesJson: string, observationsJson: string): EvaluationInputs {
  let casesValue: unknown;
  let observationsValue: unknown;
  try {
    casesValue = JSON.parse(casesJson);
  } catch {
    throw new Error("cases file is not valid JSON");
  }
  try {
    observationsValue = JSON.parse(observationsJson);
  } catch {
    throw new Error("observations file is not valid JSON");
  }
  return {
    cases: parseWithSchema(casesSchema, casesValue, "cases"),
    observations: parseWithSchema(observationsSchema, observationsValue, "observations"),
  };
}

export function buildEvaluationReport(
  { cases, observations }: EvaluationInputs,
  splitOptions?: SplitOptions,
): EvaluationReport {
  const caseIds = new Set(cases.map(({ id }) => id));
  const unknownObservation = observations.find(({ caseId }) => !caseIds.has(caseId));
  if (unknownObservation) throw new Error(`observation references unknown case ID: ${unknownObservation.caseId}`);

  const observationIds = new Set(observations.map(({ caseId }) => caseId));
  const base: EvaluationReport = {
    schemaVersion: 1,
    caseCount: cases.length,
    observationCount: observations.length,
    casesWithoutObservation: cases.filter(({ id }) => !observationIds.has(id)).length,
  };
  if (!splitOptions) return { ...base, metrics: evaluateObservations(cases, observations) };

  const split = splitEvaluationCases(cases, splitOptions);
  const observationsById = new Map(observations.map((observation) => [observation.caseId, observation]));
  const selectObservations = (items: EvaluationCase[]) => items.flatMap(({ id }) => {
    const observation = observationsById.get(id);
    return observation ? [observation] : [];
  });
  return {
    ...base,
    split: {
      seed: splitOptions.seed,
      tuneFraction: splitOptions.tuneFraction,
      tuneCaseIds: split.tune.map(({ id }) => id),
      testCaseIds: split.test.map(({ id }) => id),
      tune: evaluateObservations(split.tune, selectObservations(split.tune)),
      test: evaluateObservations(split.test, selectObservations(split.test)),
    },
  };
}

export async function runEvaluationFiles(options: {
  casesPath: string;
  observationsPath: string;
  outputPath: string;
  split?: SplitOptions;
}): Promise<EvaluationReport> {
  const [casesJson, observationsJson] = await Promise.all([
    readFile(resolve(options.casesPath), "utf8"),
    readFile(resolve(options.observationsPath), "utf8"),
  ]);
  const inputs = parseEvaluationInputs(casesJson, observationsJson);
  const report = buildEvaluationReport(inputs, options.split);
  await writeFile(resolve(options.outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function parseWithSchema<T extends z.ZodType>(schema: T, value: unknown, name: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.length ? ` at ${firstIssue.path.join(".")}` : "";
    throw new Error(`invalid ${name} data${path}: ${firstIssue?.message ?? "schema mismatch"}`);
  }
  return parsed.data;
}

export function parseEvaluationCliArgs(args: string[]): {
  casesPath: string;
  observationsPath: string;
  outputPath: string;
  split?: SplitOptions;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag?.startsWith("--")) throw new Error(`unexpected argument: ${flag ?? ""}`);
    if (values.has(flag)) throw new Error(`duplicate option: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  const allowed = new Set(["--cases", "--observations", "--output", "--seed", "--tune-fraction"]);
  for (const flag of values.keys()) if (!allowed.has(flag)) throw new Error(`unknown option: ${flag}`);
  const casesPath = values.get("--cases");
  const observationsPath = values.get("--observations");
  const outputPath = values.get("--output");
  if (!casesPath || !observationsPath || !outputPath) {
    throw new Error("required options: --cases <file> --observations <file> --output <file>");
  }
  const seed = values.get("--seed");
  const tuneFractionText = values.get("--tune-fraction");
  if ((seed === undefined) !== (tuneFractionText === undefined)) {
    throw new Error("--seed and --tune-fraction must be provided together");
  }
  if (seed !== undefined && tuneFractionText !== undefined) {
    const tuneFraction = Number(tuneFractionText);
    if (!Number.isFinite(tuneFraction) || tuneFraction <= 0 || tuneFraction >= 1) {
      throw new Error("--tune-fraction must be greater than 0 and less than 1");
    }
    return { casesPath, observationsPath, outputPath, split: { seed, tuneFraction } };
  }
  return { casesPath, observationsPath, outputPath };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write([
      "Usage: npm run eval:rag -- --cases <file> --observations <file> --output <file> [--seed <value> --tune-fraction <0..1>]",
      "Writes the full JSON report to --output and stdout.",
    ].join("\n") + "\n");
    return;
  }
  try {
    const report = await runEvaluationFiles(parseEvaluationCliArgs(args));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
