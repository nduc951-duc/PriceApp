import { expect, it } from "vitest";
import { readEnv } from "./env.js";

const common = { SUPABASE_URL: "https://project.example", SUPABASE_PUBLISHABLE_KEY: "publishable", FRONTEND_ORIGINS: "http://localhost:3000" };

it("reads the split backend environment names and defaults to the documented API port", () => {
  expect(readEnv(common)).toEqual({
    supabaseUrl: "https://project.example", supabasePublishableKey: "publishable",
    allowedOrigins: ["http://localhost:3000"], port: 4000,
  });
});

it("supports old root environment names during the local migration", () => {
  expect(readEnv({ SUPABASE_URL: common.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: common.SUPABASE_PUBLISHABLE_KEY, API_ALLOWED_ORIGINS: common.FRONTEND_ORIGINS, PORT: "4300" }).port).toBe(4300);
});
