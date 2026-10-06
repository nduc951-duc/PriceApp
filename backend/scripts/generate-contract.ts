import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { apiContracts, errorResponse, zodJsonSchema } from "../src/openapi/contract.js";

const backendRoot = resolve(import.meta.dirname, "..");
const openapiPath = resolve(backendRoot, "openapi/openapi.json");
const typesPath = resolve(backendRoot, "../frontend/src/lib/api/generated/api-types.ts");

function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const contract of apiContracts) {
    const responses = Object.fromEntries(Object.entries(contract.response).map(([status, schema]) => [status, {
      description: status === "503" ? "Tạm thời không sẵn sàng hoặc chẩn đoán dịch vụ" : "Thành công",
      content: { "application/json": { schema: zodJsonSchema(schema) } },
    }]));
    for (const status of [400, 401, 403, 409, 422, 503]) responses[status] ??= {
      description: "Yêu cầu không được xử lý",
      content: { "application/json": { schema: zodJsonSchema(errorResponse) } },
    };
    const operation: Record<string, unknown> = {
      operationId: contract.operationId,
      summary: contract.summary,
      tags: [contract.path.includes("/admin/") ? "RAG Admin" : "PriceApp"],
      responses,
    };
    if ("auth" in contract && contract.auth) operation.security = [{ bearerAuth: [] }];
    if ("owner" in contract && contract.owner) operation["x-required-role"] = ["owner"];
    if ("body" in contract && contract.body) operation.requestBody = { required: true, content: { "application/json": { schema: zodJsonSchema(contract.body) } } };
    if ("params" in contract && contract.params) {
      const schema = zodJsonSchema(contract.params) as { properties?: Record<string, unknown>; required?: string[] };
      operation.parameters = Object.entries(schema.properties ?? {}).map(([name, item]) => ({ name, in: "path", required: schema.required?.includes(name) ?? true, schema: item }));
    }
    paths[contract.path] ??= {};
    paths[contract.path][contract.method] = operation;
  }
  return {
    openapi: "3.1.0",
    info: { title: "PriceApp API", version: "1.0.0" },
    servers: [{ url: "http://localhost:4000" }],
    paths,
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
  };
}

type Schema = { type?: string | string[]; enum?: unknown[]; const?: unknown; properties?: Record<string, Schema>; required?: string[]; items?: Schema; anyOf?: Schema[]; oneOf?: Schema[]; nullable?: boolean; additionalProperties?: boolean | Schema; format?: string };
type OpenApiOperation = {
  requestBody?: { content?: { "application/json"?: { schema?: Schema } } };
  parameters?: Array<{ name: string; in: string; schema?: Schema }>;
  responses: Record<string, { content?: { "application/json"?: { schema?: Schema } } }>;
};

function schemaType(schema: Schema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(" | ");
  if (schema.type === "null") return "null";
  const unions = schema.anyOf ?? schema.oneOf;
  if (unions) return unions.map(schemaType).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.map(type => type === "null" ? "null" : schemaType({ ...schema, type })).join(" | ");
  if (schema.type === "array") return `Array<${schemaType(schema.items ?? {})}>`;
  if (schema.type === "object" || schema.properties) {
    const fields = Object.entries(schema.properties ?? {}).map(([name, item]) => `${JSON.stringify(name)}${schema.required?.includes(name) ? "" : "?"}: ${schemaType(item)}`);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") fields.push(`[key: string]: ${schemaType(schema.additionalProperties)}`);
    return `{ ${fields.join("; ")} }`;
  }
  if (schema.type === "string") return "string";
  if (schema.type === "number" || schema.type === "integer") return "number";
  if (schema.type === "boolean") return "boolean";
  return "unknown";
}

function buildTypes(document: ReturnType<typeof buildOpenApi>): string {
  const paths = document.paths as Record<string, Record<string, OpenApiOperation>>;
  const pathEntries = Object.entries(paths).map(([path, methods]) => {
    const methodEntries = Object.entries(methods).map(([method, operation]) => {
      const parameters = operation.parameters?.filter(parameter => parameter.in === "path") ?? [];
      const requestBody = operation.requestBody?.content?.["application/json"]?.schema;
      const responseEntries = Object.entries(operation.responses).map(([status, response]) => [status, response.content?.["application/json"]?.schema ? `{ content: { "application/json": ${schemaType(response.content["application/json"].schema!)} } }` : "unknown"] as const);
      const members = [
        parameters.length ? `parameters: { path: { ${parameters.map(parameter => `${JSON.stringify(parameter.name)}: ${schemaType(parameter.schema ?? {})}`).join("; ")} } }` : "",
        requestBody ? `requestBody: { content: { "application/json": ${schemaType(requestBody)} } }` : "",
        `responses: { ${responseEntries.map(([status, type]) => `${JSON.stringify(status)}: ${type}`).join("; ")} }`,
      ].filter(Boolean);
      return `${method}: { ${members.join("; ")} }`;
    });
    return `${JSON.stringify(path)}: { ${methodEntries.join("; ")} }`;
  });
  return `/* Generated from backend Fastify route schemas. Do not edit by hand. */\nexport type ApiPaths = {\n  ${pathEntries.join(";\n  ")}\n};\n\nexport type ApiResponse<Path extends keyof ApiPaths, Method extends keyof ApiPaths[Path], Status extends string = "200"> = ApiPaths[Path][Method] extends { responses: infer Responses } ? Status extends keyof Responses ? Responses[Status] extends { content: { "application/json": infer Body } } ? Body : never : never : never;\nexport type ApiRequestBody<Path extends keyof ApiPaths, Method extends keyof ApiPaths[Path]> = ApiPaths[Path][Method] extends { requestBody: { content: { "application/json": infer Body } } } ? Body : never;\n`;
}

export function generateContractFiles(): { openapi: string; types: string } {
  const document = buildOpenApi();
  return { openapi: `${JSON.stringify(document, null, 2)}\n`, types: buildTypes(document) };
}

async function main(): Promise<void> {
  const generated = generateContractFiles();
  const check = process.argv.includes("--check");
  if (check) {
    const [currentOpenapi, currentTypes] = await Promise.all([
      readFile(openapiPath, "utf8").catch(() => ""), readFile(typesPath, "utf8").catch(() => ""),
    ]);
    if (currentOpenapi !== generated.openapi || currentTypes !== generated.types) {
      throw new Error("Generated API contract is stale. Run npm run openapi:generate.");
    }
    return;
  }
  await Promise.all([mkdir(resolve(backendRoot, "openapi"), { recursive: true }), mkdir(resolve(typesPath, ".."), { recursive: true })]);
  await Promise.all([writeFile(openapiPath, generated.openapi), writeFile(typesPath, generated.types)]);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
