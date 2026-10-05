import { buildApp } from "./app.js";
import { readEnv } from "./config/env.js";
import { createSupabaseFactory } from "./repositories/supabase-client.js";

const env = readEnv();
const app = buildApp({ env, supabaseFactory: createSupabaseFactory(env) });
await app.listen({ host: "0.0.0.0", port: env.port });
