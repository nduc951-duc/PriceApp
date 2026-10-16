import { expect, it, vi } from "vitest";
import { latestRagIndexJob } from "./rag-index-job-status.js";

it("returns queue state and safe diagnostics for the owner status view", async () => {
  const maybeSingle = vi.fn(async () => ({ data: {
    status: "failed", requested_revision: 3, completed_revision: 2, attempt_count: 5, max_attempts: 5,
    available_at: "2026-10-16T12:00:00Z", last_error_code: "RAG_PROVIDER_UNAVAILABLE",
    last_error_message: "Embedding provider is unavailable.", updated_at: "2026-10-16T11:59:00Z",
  }, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const client = { from: vi.fn(() => ({ select })) };

  await expect(latestRagIndexJob(client as never)).resolves.toEqual({ job: {
    status: "failed", requestedRevision: 3, completedRevision: 2, attempts: 5, maxAttempts: 5,
    availableAt: "2026-10-16T12:00:00Z", lastErrorCode: "RAG_PROVIDER_UNAVAILABLE",
    lastErrorMessage: "Embedding provider is unavailable.", updatedAt: "2026-10-16T11:59:00Z",
  } });
  expect(client.from).toHaveBeenCalledWith("rag_index_jobs");
  expect(eq).toHaveBeenCalledWith("job_key", "verified_catalog");
});
