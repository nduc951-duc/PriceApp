import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEnv } from "../config/env.js";

export type SupabaseFactory = (token?: string) => SupabaseClient;

export function createSupabaseFactory(env: AppEnv): SupabaseFactory {
  return token => createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}
