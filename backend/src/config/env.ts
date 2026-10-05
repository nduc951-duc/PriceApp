import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  API_ALLOWED_ORIGINS: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export type AppEnv = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  allowedOrigins: string[];
  port: number;
};

export function readEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = schema.parse(input);
  const allowedOrigins = parsed.API_ALLOWED_ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean);
  if (!allowedOrigins.length || allowedOrigins.some(origin => origin === "*" || !URL.canParse(origin))) {
    throw new Error("Invalid API_ALLOWED_ORIGINS");
  }
  return {
    supabaseUrl: parsed.SUPABASE_URL,
    supabasePublishableKey: parsed.SUPABASE_PUBLISHABLE_KEY,
    allowedOrigins,
    port: parsed.PORT,
  };
}
