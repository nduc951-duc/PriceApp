import type { SupabaseClient } from "@supabase/supabase-js";
import { readCatalog } from "../repositories/catalog.repository.js";

export const getCatalog = (client: SupabaseClient) => readCatalog(client);
