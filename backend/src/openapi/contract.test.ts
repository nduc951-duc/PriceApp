import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { generateContractFiles } from "../../scripts/generate-contract.js";

const root = resolve(import.meta.dirname, "../..");

it("keeps checked-in OpenAPI and frontend types synchronized with Fastify schemas", () => {
  const generated = generateContractFiles();
  expect(readFileSync(resolve(root, "openapi/openapi.json"), "utf8")).toBe(generated.openapi);
  expect(readFileSync(resolve(root, "../frontend/src/lib/api/generated/api-types.ts"), "utf8")).toBe(generated.types);
});
