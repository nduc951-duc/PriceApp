import { readEnv } from "./config/env.js";
import { createRagWorkerClient } from "./rag-worker-auth.js";

const client = await createRagWorkerClient(readEnv());
const { data, error } = await client.rpc("request_rag_catalog_reindex");
await client.auth.signOut();
if (error || typeof data !== "number") {
  throw new Error("Could not queue the verified catalog for RAG indexing. Check worker role permissions.");
}
process.stdout.write(`Queued verified catalog indexing request ${data}. The worker will process it asynchronously.\n`);
