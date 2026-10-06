import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import { signSourceFile } from "../repositories/source-files.repository.js";
import { parseObjectPath } from "../schemas/source-files.schema.js";

export function getSourceSignedUrl(client: SupabaseClient, body: unknown) {
  const path = parseObjectPath(body);
  if (!path) throw new ApiError(400, "INVALID_INPUT", "Invalid source file path");
  return signSourceFile(client, path);
}
