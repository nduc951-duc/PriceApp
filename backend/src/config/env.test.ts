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

it("keeps the worker disabled unless both server-only worker credentials are configured", () => {
  expect(readEnv(common).ragWorker).toBeUndefined();
  expect(readEnv({ ...common, RAG_WORKER_EMAIL: "", RAG_WORKER_PASSWORD: "" }).ragWorker).toBeUndefined();
  expect(readEnv({ ...common, RAG_WORKER_EMAIL: "rag-worker@example.test", RAG_WORKER_PASSWORD: "worker-test-password" }).ragWorker)
    .toEqual({ email: "rag-worker@example.test", password: "worker-test-password" });
  expect(() => readEnv({ ...common, RAG_WORKER_EMAIL: "rag-worker@example.test" }))
    .toThrow("RAG_WORKER_EMAIL and RAG_WORKER_PASSWORD must be configured together");
});

it("accepts an optional server-only public RAG feedback signing secret", () => {
  expect(readEnv(common).ragFeedbackHmacSecret).toBeUndefined();
  expect(readEnv({ ...common, RAG_FEEDBACK_HMAC_SECRET: "x".repeat(40) }).ragFeedbackHmacSecret).toBe("x".repeat(40));
  expect(() => readEnv({ ...common, RAG_FEEDBACK_HMAC_SECRET: "short" })).toThrow();
});
