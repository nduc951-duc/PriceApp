import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEnv } from "./config/env.js";

export async function createRagWorkerClient(env: AppEnv): Promise<SupabaseClient> {
  if (!env.ragWorker) {
    throw new Error("Configure RAG_WORKER_EMAIL and RAG_WORKER_PASSWORD in the backend secret store.");
  }
  const client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { autoRefreshToken: true, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword(env.ragWorker);
  if (error || !data.session) {
    throw new Error("RAG worker authentication failed. Check the dedicated Auth account and Custom Access Token Hook.");
  }
  const { data: claims, error: claimsError } = await client.auth.getClaims(data.session.access_token);
  if (claimsError || claims?.claims?.role !== "rag_index_worker") {
    await client.auth.signOut();
    throw new Error("RAG worker token lacks the rag_index_worker database role. Check worker registration and the Custom Access Token Hook.");
  }
  return client;
}
