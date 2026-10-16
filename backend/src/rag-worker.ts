import { readEnv } from "./config/env.js";
import { createRagWorkerClient } from "./rag-worker-auth.js";
import { ragIndexJobsRepository } from "./repositories/rag-index-jobs.repository.js";
import { indexRag } from "./services/rag-index.service.js";
import { processNextRagIndexJob } from "./services/rag-index-worker.js";

const env = readEnv();
if (!env.ragWorker) {
  throw new Error("Automatic RAG indexing is disabled. Configure RAG_WORKER_EMAIL and RAG_WORKER_PASSWORD in the backend secret store.");
}

const client = await createRagWorkerClient(env);

const repository = ragIndexJobsRepository(client);
let stopping = false;
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const stop = () => { stopping = true; };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.stdout.write("RAG indexing worker started with the dedicated database role.\n");

while (!stopping) {
  try {
    const result = await processNextRagIndexJob(repository, async () => {
      const indexed = await indexRag(client);
      return { status: indexed.status as "running" | "completed" };
    });
    if (result.status !== "completed") await sleep(2_500);
  } catch (error) {
    const code = error instanceof Error ? error.name : "UnknownError";
    process.stderr.write(`RAG indexing worker loop failed: ${code}\n`);
    await sleep(5_000);
  }
}

await client.auth.signOut();
