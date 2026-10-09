# RAG evaluation runner

The runner consumes caller-supplied JSON and writes the measured metrics to a JSON report. It does not generate labels, observations, or scores. Keep the input files and the code revision with each exported report to make a run reproducible.

From `backend/`, run against your own reviewed cases and captured observations:

```powershell
npx tsx src/rag/evaluation-runner.ts --cases <cases.json> --observations <observations.json> --output <report.json>
```

To create a deterministic tune/test split, pass both split options. Test metrics are reported separately as the held-out result:

```powershell
npx tsx src/rag/evaluation-runner.ts --cases <cases.json> --observations <observations.json> --output <report.json> --seed <fixed-seed> --tune-fraction <fraction-between-0-and-1>
```

The cases file is a JSON array of objects with `id`, `sourceId`, `questionFamilyId`, and optional `label`. Labels use `status: "candidate"` while awaiting review, or `status: "adjudicated"` with `adjudicator`, `expectedOutcome`, and `relevantVariantIds`; expected variant, package, tier, amount, and citation IDs are optional. The observations file is a JSON array with `caseId`, `retrievedVariantIds`, `latencyMs`, and optional `answer` fields (`abstained`, variant/package/tier/amount, citation IDs).

Candidate and unlabeled cases remain in split membership and report counts but never contribute to metric denominators. Splits keep every connected source and question-family group together; fewer than two independent groups is an error. The JSON report omits a run timestamp and includes input counts, missing-observation count, split membership, and metrics so equivalent inputs and options yield equivalent report content.
