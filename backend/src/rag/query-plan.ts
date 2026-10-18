import { z } from "zod";
import { generateQueryPlanText, RagProviderUnavailableError } from "./provider.js";
import { catalogIdentityQuestion, isPartialDimension, specificPriceLookupHint, understandQuery } from "./query-understanding.js";
import { isUnqualifiedVariantListQuestion } from "./variant-list-intent.js";

const requestIntentSchema = z.enum(["price_lookup", "catalog_list", "product_info", "advice", "comparison"]);
const requestedFieldSchema = z.enum(["price", "unit", "variants", "products", "facts", "source", "suitability"]);

const requestSchema = z.object({
  intent: requestIntentSchema,
  productText: z.string().trim().min(1).max(200).optional(),
  categoryText: z.string().trim().min(1).max(100).optional(),
  material: z.string().trim().min(1).max(80).optional(),
  specifications: z.array(z.string().trim().min(1).max(80)).max(12),
  requestedFields: z.array(requestedFieldSchema).max(8),
  priceTier: z.enum(["retail", "wholesale", "dealer"]).optional(),
  requestedQuantity: z.object({
    amount: z.number().positive().max(1_000_000),
    unit: z.string().trim().min(1).max(32).optional(),
  }).strict().optional(),
  constraints: z.array(z.string().trim().min(1).max(160)).max(12),
  previousReference: z.string().trim().min(1).max(120).optional(),
}).strict();

const queryPlanSchema = z.object({
  intent: z.enum([
    "price_lookup", "catalog_list", "product_info", "advice", "comparison",
    "multi_intent", "clarification", "out_of_domain",
  ]),
  requests: z.array(requestSchema).max(4),
  confidence: z.number().min(0).max(1).optional(),
  unresolvedFields: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  clarificationQuestion: z.string().trim().min(1).max(240).optional(),
}).strict().superRefine((plan, context) => {
  if (plan.intent === "clarification") {
    if (plan.requests.length > 0) context.addIssue({ code: "custom", message: "clarification plans cannot contain retrieval requests" });
    if (!plan.clarificationQuestion) context.addIssue({ code: "custom", message: "clarification plans require one clarification question" });
    return;
  }
  if (plan.intent === "out_of_domain") {
    if (plan.requests.length > 0) context.addIssue({ code: "custom", message: "out-of-domain plans cannot contain retrieval requests" });
    return;
  }
  const expectedRequestCount = plan.intent === "multi_intent" || plan.intent === "comparison" ? 2 : 1;
  if (plan.requests.length < expectedRequestCount) {
    context.addIssue({ code: "custom", message: `${plan.intent} plans require at least ${expectedRequestCount} request(s)` });
  }
  if (plan.intent === "comparison" && plan.requests.some(({ intent }) => intent !== "comparison")) {
    context.addIssue({ code: "custom", message: "comparison plans require two comparison targets" });
  }
  if (plan.intent !== "multi_intent" && plan.intent !== "comparison" && plan.requests.length > 1) {
    context.addIssue({ code: "custom", message: `${plan.intent} plans must not contain multiple requests` });
  }
  if (plan.intent !== "multi_intent" && plan.requests.some(({ intent }) => intent !== plan.intent)) {
    context.addIssue({ code: "custom", message: "the requested operation must match the plan intent" });
  }
});

export type RagQueryRequest = z.infer<typeof requestSchema>;
export type RagQueryPlan = z.infer<typeof queryPlanSchema>;
export type QueryPlanGenerator = (input: { question: string; context?: string[] }) => Promise<string>;

export interface PlanRagQueryInput {
  question: string;
  context?: string[];
  generate?: QueryPlanGenerator;
}

const MIN_PLAN_CONFIDENCE = 0.55;
const SAFE_CLARIFICATION = "Bạn muốn tra giá, xem các quy cách hay hỏi thông tin/tư vấn về mặt hàng nào? Hãy nói rõ tên hàng hoặc quy cách để mình tìm đúng.";

export async function planRagQuery(input: PlanRagQueryInput): Promise<RagQueryPlan> {
  const question = input.question.trim();
  if (!question || question.length > 1000) throw new Error("question must contain between 1 and 1000 characters");

  const fastFamilyPricePlan = createFamilyPricePlan(question);
  if (fastFamilyPricePlan) return fastFamilyPricePlan;
  const fastPricePlan = createSpecificPricePlan(question);
  if (fastPricePlan) return fastPricePlan;
  const fastProductDiscoveryPlan = createProductDiscoveryPlan(question);
  if (fastProductDiscoveryPlan) return fastProductDiscoveryPlan;
  const fastPurchaseCatalogPlan = createPurchaseCatalogPlan(question);
  if (fastPurchaseCatalogPlan) return fastPurchaseCatalogPlan;
  const fastVariantListPlan = createNamedVariantListPlan(question);
  if (fastVariantListPlan) return fastVariantListPlan;
  const fastFactsPlan = createCatalogFactsPlan(question);
  if (fastFactsPlan) return fastFactsPlan;

  const context = (input.context ?? []).slice(-4).map((item) => item.trim().slice(0, 300)).filter(Boolean);
  const generate = input.generate ?? generateQueryPlanText;
  let raw: string;
  try {
    raw = await generate({ question, ...(context.length ? { context } : {}) });
  } catch (error) {
    if (error instanceof RagProviderUnavailableError || (error instanceof Error && /RAG_(?:CHAT_MODEL|AI_BASE_URL)/i.test(error.message))) {
      return clarificationPlan(SAFE_CLARIFICATION);
    }
    throw error;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return clarificationPlan(SAFE_CLARIFICATION);
  }
  const parsed = queryPlanSchema.safeParse(decoded);
  if (!parsed.success) return clarificationPlan(SAFE_CLARIFICATION);
  if (parsed.data.intent === "clarification") {
    return clarificationPlan(parsed.data.clarificationQuestion ?? SAFE_CLARIFICATION);
  }
  if (parsed.data.confidence !== undefined && parsed.data.confidence < MIN_PLAN_CONFIDENCE) {
    return clarificationPlan(parsed.data.clarificationQuestion ?? SAFE_CLARIFICATION);
  }
  // A valid model response may still omit literal identity fields. Never turn a
  // named catalog lookup into an unfiltered listing, or discard its model code.
  if (parsed.data.intent === "catalog_list" && parsed.data.requests.length === 1) {
    const request = parsed.data.requests[0]!;
    const explicit = understandQuery(catalogIdentityQuestion(question));
    const productText = uniqueProductText([...explicit.aliases, ...explicit.nameTerms]);
    if (!request.productText && productText) request.productText = productText.slice(0, 200);
    request.specifications = uniqueProductTextValues([
      ...request.specifications, ...explicit.dimensions, ...explicit.specCodes,
    ]).slice(0, 12);
    if (!request.material && explicit.material) request.material = explicit.material;
  }
  return parsed.data;
}

function uniqueProductTextValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.toLocaleLowerCase("vi-VN").replace(/\s+/gu, " ").trim();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function createProductDiscoveryPlan(question: string): RagQueryPlan | null {
  const normalized = question.toLocaleLowerCase("vi-VN").replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "");
  if (!/\b(?:san pham|mat hang)\s+(?:gi|nao)\b/u.test(normalized)
    || /\b(?:gia|bao nhieu|bao gia|so sanh)\b/u.test(normalized)) return null;

  const identityQuestion = question
    .replace(/(?:bên\s+bạn|ben\s+ban|bạn\s+có|ban\s+co|tôi\s+muốn|toi\s+muon)/giu, " ");
  const parsed = understandQuery(catalogIdentityQuestion(identityQuestion));
  const productText = uniqueProductText([...parsed.aliases, ...parsed.nameTerms]);
  if (!productText) return null;

  return {
    intent: "catalog_list",
    confidence: 0.95,
    unresolvedFields: [],
    requests: [{
      intent: "catalog_list",
      productText,
      ...(parsed.material ? { material: parsed.material } : {}),
      specifications: [...parsed.dimensions, ...parsed.specCodes],
      requestedFields: ["products"],
      constraints: [],
    }],
  };
}

function createPurchaseCatalogPlan(question: string): RagQueryPlan | null {
  const normalized = question.toLocaleLowerCase("vi-VN").replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "");
  if (!/\b(?:muon mua|tinh mua)\b/u.test(normalized)
    || /\b(?:gia|bao nhieu|bao gia|so sanh|tu van|nen chon|phu hop|dung cho)\b/u.test(normalized)) return null;

  const productQuestion = question
    .replace(/(?:tôi|toi)?\s*(?:muốn|muon)\s+(?:mua|lấy|lay)/giu, " ")
    .replace(/(?:[,，;:]?\s*)(?:(?:bên\s+)?bạn\s+)?(?:có\s+(?:hàng\s+)?không|còn\s+hàng\s+không)[?!.]*$/iu, " ");
  const parsed = understandQuery(productQuestion);
  if (parsed.quantity !== undefined || parsed.package || parsed.unit) return null;
  const productText = uniqueProductText([...parsed.aliases, ...parsed.nameTerms]);
  if (!productText) return null;

  return {
    intent: "catalog_list",
    confidence: 0.95,
    unresolvedFields: [],
    requests: [{
      intent: "catalog_list",
      productText,
      ...(parsed.material ? { material: parsed.material } : {}),
      specifications: [...parsed.dimensions, ...parsed.specCodes],
      requestedFields: ["variants", "price"],
      ...(parsed.tier ? { priceTier: parsed.tier } : {}),
      constraints: [],
    }],
  };
}

function uniqueProductText(terms: string[]): string {
  const uniqueTerms = new Map<string, string>();
  for (const term of terms) {
    const key = term.toLocaleLowerCase("vi-VN").replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "");
    if (!uniqueTerms.has(key)) uniqueTerms.set(key, term);
  }
  return [...uniqueTerms.values()].join(" ").trim();
}

function createNamedVariantListPlan(question: string): RagQueryPlan | null {
  if (!isUnqualifiedVariantListQuestion(question)) return null;
  if (/\b(?:nhom|danh muc|trong)\b/u.test(question.replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase())) return null;
  const parsed = understandQuery(question.replace(/cửa hàng|liệt kê/giu, ""));
  const productText = uniqueProductText([...parsed.aliases, ...parsed.nameTerms]);
  if (!productText) return null;

  return {
    intent: "catalog_list",
    requests: [{
      intent: "catalog_list",
      productText,
      ...(parsed.material ? { material: parsed.material } : {}),
      specifications: [...parsed.dimensions, ...parsed.specCodes],
      requestedFields: ["variants"],
      ...(parsed.tier ? { priceTier: parsed.tier } : {}),
      constraints: [],
    }],
    unresolvedFields: [],
  };
}

function createCatalogFactsPlan(question: string): RagQueryPlan | null {
  const normalized = question.toLocaleLowerCase("vi-VN").replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "");
  if (!/\b(?:quy cach|kich thuoc|dong goi|chat lieu|don vi|thong tin)\b/u.test(normalized)
    || /\b(?:gia|bao nhieu|so sanh|tu van|phu hop|dung cho|va|voi|nhom|danh muc|trong)\b/u.test(normalized)) return null;
  const parsed = understandQuery(catalogIdentityQuestion(question));
  if (!parsed.nameTerms.length) return null;
  return { intent: "product_info", confidence: 0.95, unresolvedFields: [], requests: [{
    intent: "product_info", productText: parsed.nameTerms.join(" "),
    ...(parsed.material ? { material: parsed.material } : {}),
    specifications: [...parsed.dimensions, ...parsed.specCodes], requestedFields: ["facts"], constraints: [],
  }] };
}

function createSpecificPricePlan(question: string): RagQueryPlan | null {
  const hint = specificPriceLookupHint(question);
  if (!hint) return null;

  return {
    intent: "price_lookup",
    requests: [{
      intent: "price_lookup",
      productText: hint.productText,
      ...(hint.material ? { material: hint.material } : {}),
      specifications: hint.specifications,
      requestedFields: ["price"],
      ...(hint.tier ? { priceTier: hint.tier } : {}),
      ...(hint.quantity !== undefined ? {
        requestedQuantity: { amount: hint.quantity, ...(hint.unit ? { unit: hint.unit } : {}) },
      } : {}),
      constraints: [],
    }],
    confidence: 0.95,
    unresolvedFields: [],
  };
}

function createFamilyPricePlan(question: string): RagQueryPlan | null {
  const parsed = understandQuery(question);
  const normalized = question.toLocaleLowerCase("vi-VN").replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "");
  const asksForPrice = /\b(?:gia|bao\s+nhieu|bao\s+gia)\b/u.test(normalized);
  const specifications = [...parsed.dimensions, ...parsed.specCodes];
  if (!asksForPrice || parsed.tierConflict || specifications.length !== 1 || !isPartialDimension(specifications[0] ?? "")
    || !parsed.nameTerms.length || parsed.package || parsed.unit || parsed.quantity !== undefined) return null;

  return {
    intent: "catalog_list",
    requests: [{
      intent: "catalog_list",
      productText: [...parsed.aliases, ...parsed.nameTerms].join(" "),
      ...(parsed.material ? { material: parsed.material } : {}),
      specifications,
      requestedFields: ["variants", "price"],
      ...(parsed.tier ? { priceTier: parsed.tier } : {}),
      constraints: [],
    }],
    confidence: 0.95,
    unresolvedFields: [],
  };
}

function clarificationPlan(question: string): RagQueryPlan {
  return {
    intent: "clarification",
    requests: [],
    confidence: 0,
    unresolvedFields: ["product_or_requested_task"],
    clarificationQuestion: question,
  };
}
