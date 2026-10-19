import { describe, expect, it, vi } from "vitest";
import { processNextRagIndexJob, type RagIndexJobRepository } from "../../src/services/rag-index-worker.js";
import { RagIndexFailure } from "../../src/services/rag-index.service.js";

const job = { id: 12, requested_revision: 4, claimed_revision: 4, lease_token: "lease-1" };

function repository(overrides: Partial<RagIndexJobRepository> = {}) {
  return {
    claim: vi.fn(async () => ({ data: job, error: null })),
    complete: vi.fn(async () => ({ data: { status: "completed" as const }, error: null })),
    fail: vi.fn(async () => ({ data: { status: "queued" as const }, error: null })),
    ...overrides,
  } satisfies RagIndexJobRepository;
}

describe("automatic RAG index worker", () => {
  it("drains all index batches and completes only the claimed revision", async () => {
    const repo = repository();
    const indexBatch = vi.fn()
      .mockResolvedValueOnce({ status: "running" as const })
      .mockResolvedValueOnce({ status: "completed" as const });

    await expect(processNextRagIndexJob(repo, indexBatch)).resolves.toEqual({ status: "completed" });
    expect(indexBatch).toHaveBeenCalledTimes(2);
    expect(repo.complete).toHaveBeenCalledWith(job);
    expect(repo.fail).not.toHaveBeenCalled();
  });

  it("does not invoke indexing when there is no queued or expired job", async () => {
    const repo = repository({ claim: vi.fn(async () => ({ data: null, error: null })) });
    const indexBatch = vi.fn();

    await expect(processNextRagIndexJob(repo, indexBatch)).resolves.toEqual({ status: "idle" });
    expect(indexBatch).not.toHaveBeenCalled();
  });

  it("records a safe diagnostic and can process the same job after the database retries it", async () => {
    const repo = repository({
      claim: vi.fn()
        .mockResolvedValueOnce({ data: job, error: null })
        .mockResolvedValueOnce({ data: job, error: null }),
    });
    const flakyIndex = vi.fn()
      .mockRejectedValueOnce(new Error("upstream failed with private-token=do-not-store"))
      .mockResolvedValueOnce({ status: "completed" as const });

    await expect(processNextRagIndexJob(repo, flakyIndex)).resolves.toMatchObject({ status: "retry_scheduled" });
    expect(repo.fail).toHaveBeenCalledWith(job, expect.objectContaining({
      code: "INDEX_BATCH_FAILED",
      message: expect.not.stringContaining("private-token"),
    }));
    await expect(processNextRagIndexJob(repo, flakyIndex)).resolves.toEqual({ status: "completed" });
    expect(repo.complete).toHaveBeenCalledWith(job);
    expect(flakyIndex).toHaveBeenCalledTimes(2);
  });

  it("keeps a coalesced verification request queued for another pass", async () => {
    const repo = repository({
      complete: vi.fn(async () => ({ data: { status: "queued" as const }, error: null })),
    });

    await expect(processNextRagIndexJob(repo, vi.fn().mockResolvedValue({ status: "completed" as const })))
      .resolves.toEqual({ status: "queued" });
  });

  it("persists a safe stage and database error code for diagnosis", async () => {
    const repo = repository();
    await processNextRagIndexJob(repo, vi.fn().mockRejectedValue(
      new RagIndexFailure("RAG_STAGE_CHUNKS_FAILED_PGRST204", "RAG indexing failed during stage_chunks."),
    ));
    expect(repo.fail).toHaveBeenCalledWith(job, {
      code: "RAG_STAGE_CHUNKS_FAILED_PGRST204",
      message: "RAG indexing failed during stage_chunks.",
    });
  });
});
