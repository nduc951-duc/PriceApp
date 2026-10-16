import type { SupabaseClient } from "@supabase/supabase-js";
import type { RagIndexJob, RagIndexJobRepository } from "../services/rag-index-worker.js";

type RpcResult = { data: unknown; error: unknown | null };

export function ragIndexJobsRepository(client: SupabaseClient): RagIndexJobRepository {
  const rpc = async (name: string, args?: Record<string, unknown>) => await client.rpc(name, args) as unknown as RpcResult;
  return {
    async claim() {
      const { data, error } = await rpc("claim_rag_index_job");
      if (error) return { data: null, error };
      const row = Array.isArray(data) ? data[0] : null;
      if (!row || typeof row !== "object") return { data: null, error: null };
      const value = row as Record<string, unknown>;
      if (typeof value.job_id !== "number" || typeof value.requested_revision !== "number"
          || typeof value.claimed_revision !== "number" || typeof value.lease_token !== "string") {
        return { data: null, error: new Error("Invalid RAG job claim response") };
      }
      const job: RagIndexJob = {
        id: value.job_id,
        requested_revision: value.requested_revision,
        claimed_revision: value.claimed_revision,
        lease_token: value.lease_token,
      };
      return { data: job, error: null };
    },
    async heartbeat(job) {
      const { data, error } = await rpc("heartbeat_rag_index_job", { p_job_id: job.id, p_lease_token: job.lease_token });
      return { error: error ?? (data === true ? null : new Error("RAG job lease expired")) };
    },
    async complete(job) {
      const { data, error } = await rpc("complete_rag_index_job", {
        p_job_id: job.id, p_lease_token: job.lease_token, p_claimed_revision: job.claimed_revision,
      });
      if (error) return { data: null, error };
      if (data !== "completed" && data !== "queued") return { data: null, error: new Error("Invalid RAG job completion response") };
      return { data: { status: data }, error: null };
    },
    async fail(job, diagnostic) {
      const { data, error } = await rpc("fail_rag_index_job", {
        p_job_id: job.id, p_lease_token: job.lease_token,
        p_error_code: diagnostic.code, p_error_message: diagnostic.message,
      });
      if (error) return { data: null, error };
      if (data !== "queued" && data !== "failed") return { data: null, error: new Error("Invalid RAG job failure response") };
      return { data: { status: data }, error: null };
    },
  };
}
