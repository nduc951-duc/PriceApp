import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  CUSTOMER_ORDER_HMAC_SECRET: z.string().min(32).optional(),
  RAG_WORKER_EMAIL: z.preprocess(value => value === "" ? undefined : value, z.email().optional()),
  RAG_WORKER_PASSWORD: z.preprocess(value => value === "" ? undefined : value, z.string().min(1).optional()),
  FRONTEND_ORIGINS: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

export type AppEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  customerOrderHmacSecret?: string;
  ragWorker?: { email: string; password: string };
  allowedOrigins: string[];
  port: number;
};

export function readEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.parse({
    ...input,
    FRONTEND_ORIGINS: input.FRONTEND_ORIGINS ?? input.API_ALLOWED_ORIGINS,
    API_PORT: input.API_PORT ?? input.PORT,
  });
  if (Boolean(parsed.RAG_WORKER_EMAIL) !== Boolean(parsed.RAG_WORKER_PASSWORD)) {
    throw new Error("RAG_WORKER_EMAIL and RAG_WORKER_PASSWORD must be configured together");
  }
  const allowedOrigins = parsed.FRONTEND_ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean);
  if (!allowedOrigins.length || allowedOrigins.some(origin => origin === "*" || !URL.canParse(origin))) {
    throw new Error("Invalid FRONTEND_ORIGINS");
  }
  return {
    supabaseUrl: parsed.SUPABASE_URL,
    supabasePublishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
    ...(parsed.CUSTOMER_ORDER_HMAC_SECRET ? { customerOrderHmacSecret: parsed.CUSTOMER_ORDER_HMAC_SECRET } : {}),
    ...(parsed.RAG_WORKER_EMAIL && parsed.RAG_WORKER_PASSWORD
      ? { ragWorker: { email: parsed.RAG_WORKER_EMAIL, password: parsed.RAG_WORKER_PASSWORD } }
      : {}),
    allowedOrigins,
    port: parsed.API_PORT,
  };
}
