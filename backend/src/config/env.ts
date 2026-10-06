import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  FRONTEND_ORIGINS: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
});

export type AppEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  allowedOrigins: string[];
  port: number;
};

export function readEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.parse({
    ...input,
    FRONTEND_ORIGINS: input.FRONTEND_ORIGINS ?? input.API_ALLOWED_ORIGINS,
    API_PORT: input.API_PORT ?? input.PORT,
  });
  const allowedOrigins = parsed.FRONTEND_ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean);
  if (!allowedOrigins.length || allowedOrigins.some(origin => origin === "*" || !URL.canParse(origin))) {
    throw new Error("Invalid FRONTEND_ORIGINS");
  }
  return {
    supabaseUrl: parsed.SUPABASE_URL,
    supabasePublishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
    allowedOrigins,
    port: parsed.API_PORT,
  };
}
