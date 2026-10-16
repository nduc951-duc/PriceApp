import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";

export async function latestRagIndexJob(client: SupabaseClient) {
  const { data, error } = await client.from("rag_index_jobs")
    .select("status,requested_revision,completed_revision,attempt_count,max_attempts,available_at,last_error_code,last_error_message,updated_at")
    .eq("job_key", "verified_catalog").maybeSingle();
  if (error) throw new ApiError(503, "RAG_UNAVAILABLE", "RAG indexing job status unavailable.");
  if (!data) return { job: null };
  return { job: {
    status: data.status,
    requestedRevision: data.requested_revision,
    completedRevision: data.completed_revision,
    attempts: data.attempt_count,
    maxAttempts: data.max_attempts,
    availableAt: data.available_at,
    lastErrorCode: data.last_error_code,
    lastErrorMessage: data.last_error_message,
    updatedAt: data.updated_at,
  } };
}
