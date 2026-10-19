import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { generateContractFiles, normalizeLineEndings } from "../../scripts/generate-contract.js";

const root = resolve(import.meta.dirname, "../..");

it("normalizes Windows line endings before comparing generated API files", () => {
  expect(normalizeLineEndings("{\r\n  \"openapi\": \"3.1.0\"\r\n}\r\n")).toBe("{\n  \"openapi\": \"3.1.0\"\n}\n");
});

it("keeps checked-in OpenAPI and frontend types synchronized with Fastify schemas", () => {
  const generated = generateContractFiles();
  expect(normalizeLineEndings(readFileSync(resolve(root, "openapi/openapi.json"), "utf8"))).toBe(generated.openapi);
  expect(normalizeLineEndings(readFileSync(resolve(root, "../frontend/src/lib/api/generated/api-types.ts"), "utf8"))).toBe(generated.types);
});
