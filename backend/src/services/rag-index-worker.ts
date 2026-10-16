import { ApiError } from "../middleware/errors.js";

export type RagIndexJob = {
  id: number;
  requested_revision: number;
  claimed_revision: number;
  lease_token: string;
};

export type RagIndexJobRepository = {
  claim(): Promise<{ data: RagIndexJob | null; error: unknown | null }>;
  heartbeat?(job: RagIndexJob): Promise<{ error: unknown | null }>;
  complete(job: RagIndexJob): Promise<{ data: { status: "completed" | "queued" } | null; error: unknown | null }>;
  fail(job: RagIndexJob, diagnostic: { code: string; message: string }): Promise<{ data: { status: "queued" | "failed" } | null; error: unknown | null }>;
};

export type IndexBatch = () => Promise<{ status: "running" | "completed" }>;
export type RagIndexWorkerResult = { status: "idle" | "completed" | "queued" | "retry_scheduled" | "failed" };

function diagnosticFor(error: unknown) {
  if (error instanceof Error && "diagnosticCode" in error && typeof error.diagnosticCode === "string") {
    return { code: error.diagnosticCode.slice(0, 80), message: error.message.slice(0, 500) };
  }
  if (error instanceof ApiError) return { code: error.code, message: error.message.slice(0, 500) };
  const name = error instanceof Error ? error.name : "UnknownError";
  return {
    code: name === "RagProviderUnavailableError" ? "RAG_PROVIDER_UNAVAILABLE" : "INDEX_BATCH_FAILED",
    message: name === "RagProviderUnavailableError"
      ? "Embedding provider is unavailable. Check its backend configuration and network access."
      : "Index batch failed. Check the backend worker logs for the job ID.",
  };
}

export async function processNextRagIndexJob(
  repository: RagIndexJobRepository,
  indexBatch: IndexBatch,
  maxBatches = 256,
): Promise<RagIndexWorkerResult> {
  const { data: job, error: claimError } = await repository.claim();
  if (claimError) throw new Error("Could not claim RAG indexing job.");
  if (!job) return { status: "idle" };

  try {
    let batchCount = 0;
    let result: { status: "running" | "completed" } = { status: "running" };
    while (result.status === "running") {
      if (++batchCount > maxBatches) throw new Error("Index generation exceeded the safe batch limit.");
      const heartbeat = await repository.heartbeat?.(job);
      if (heartbeat?.error) throw new Error("RAG indexing job lease was lost.");
      result = await indexBatch();
    }
    const completion = await repository.complete(job);
    if (completion.error || !completion.data) throw new Error("Could not complete RAG indexing job.");
    return { status: completion.data.status === "queued" ? "queued" : "completed" };
  } catch (error) {
    const failure = await repository.fail(job, diagnosticFor(error));
    if (failure.error || !failure.data) throw new Error("Could not record RAG indexing failure.");
    return { status: failure.data.status === "queued" ? "retry_scheduled" : "failed" };
  }
}
