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
  conversationPhrases: z.array(z.string().trim().min(1).max(240)).max(12).optional(),
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
export type RagQueryPlan = z.infer<typeof queryPlanSchema> & { understandingSource?: "model" | "rules_fallback" };
export type QueryPlanGenerator = (input: { question: string; context?: string[]; analysisFeedback?: string }) => Promise<string>;

export interface PlanRagQueryInput {
  question: string;
  context?: string[];
  generate?: QueryPlanGenerator;
  analysisFeedback?: string;
}

const MIN_PLAN_CONFIDENCE = 0.55;
const SAFE_CLARIFICATION = "Bạn muốn tra giá, xem các quy cách hay hỏi thông tin/tư vấn về mặt hàng nào? Hãy nói rõ tên hàng hoặc quy cách để mình tìm đúng.";

export async function planRagQuery(input: PlanRagQueryInput): Promise<RagQueryPlan> {
  const question = input.question.trim();
  if (!question || question.length > 1000) throw new Error("question must contain between 1 and 1000 characters");

  const context = (input.context ?? []).slice(-4).map((item) => item.trim().slice(0, 300)).filter(Boolean);
  const generate = input.generate ?? generateQueryPlanText;
  let raw: string;
  try {
    raw = await generate({ question, ...(context.length ? { context } : {}), ...(input.analysisFeedback ? { analysisFeedback: input.analysisFeedback } : {}) });
  } catch (error) {
    if (error instanceof RagProviderUnavailableError || (error instanceof Error && /RAG_(?:CHAT_MODEL|AI_BASE_URL)/i.test(error.message))) {
      return { ...(planCatalogFallback(question) ?? clarificationPlan(SAFE_CLARIFICATION)), understandingSource: "rules_fallback" };
    }
    throw error;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return clarificationPlan(SAFE_CLARIFICATION);
  }
  // Local constrained models sometimes emit blank optional strings instead of
  // omitting them. Normalize only empty values; invalid intents/types still fail.
  if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
    const root = decoded as Record<string, unknown>;
    const removeBlanks = (values: unknown) => Array.isArray(values)
      ? values.filter(value => typeof value !== "string" || value.trim().length > 0) : values;
    if ("unresolvedFields" in root) root.unresolvedFields = removeBlanks(root.unresolvedFields);
    if ("conversationPhrases" in root) root.conversationPhrases = removeBlanks(root.conversationPhrases);
    if (Array.isArray(root.requests)) for (const raw of root.requests) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const request = raw as Record<string, unknown>;
      for (const key of ["productText", "categoryText", "material", "previousReference"]) {
        if (typeof request[key] === "string" && !(request[key] as string).trim()) delete request[key];
      }
      for (const key of ["specifications", "constraints", "requestedFields"]) {
        if (key in request) request[key] = removeBlanks(request[key]);
      }
    }
  }
  const parsed = queryPlanSchema.safeParse(decoded);
  if (!parsed.success) return clarificationPlan(SAFE_CLARIFICATION);
  if (parsed.data.intent === "clarification") {
    return clarificationPlan(parsed.data.clarificationQuestion ?? SAFE_CLARIFICATION);
  }
  if (parsed.data.confidence !== undefined && parsed.data.confidence < MIN_PLAN_CONFIDENCE) {
    return clarificationPlan(parsed.data.clarificationQuestion ?? SAFE_CLARIFICATION);
  }
  // Re-read the complete sentence once when the model drops its subject. Do not
  // substitute the conversational residue for a product name.
  const explicit = understandQuery(catalogIdentityQuestion(question));
  const missingIdentity = parsed.data.requests.some(request => !request.productText && !request.categoryText);
  if (missingIdentity && explicit.nameTerms.length && !input.analysisFeedback) {
    return planRagQuery({ ...input, generate, analysisFeedback:
      "The previous plan omitted productText. Re-read the ENTIRE current question, including earlier clauses: the purchase clause names the product and a later introduction clause refers to that same product. Extract only the product name into productText. Do not put words requesting an introduction into the product name. Return the complete corrected plan. Previous plan: " + JSON.stringify(parsed.data) });
  }
  if (missingIdentity && explicit.nameTerms.length > 2) return clarificationPlan(SAFE_CLARIFICATION);
  // A new, explicitly named lookup does not inherit old measurements. A genuine
  // reference must be resolved by the model and point to wording in this turn.
  for (const request of parsed.data.requests) {
    const reference = request.previousReference?.toLocaleLowerCase("vi-VN");
    const referencesCurrentText = !!reference && question.toLocaleLowerCase("vi-VN").includes(reference);
    if (parsed.data.requests.length === 1 && context.length && request.productText && !referencesCurrentText) {
      const named = understandQuery(request.productText).nameTerms;
      const currentNames = new Set(explicit.nameTerms.map(word => word.toLocaleLowerCase("vi-VN")));
      if (named.length && named.every(word => currentNames.has(word.toLocaleLowerCase("vi-VN")))) {
        // Replan the same full question without history; a regex parser cannot
        // safely replace model-understood prose dimensions such as diameter/length.
        return planRagQuery({ question, generate });
      }
    }
  }
  // Retain literal model codes and dimensions, even when an extraction drops one.
  if (parsed.data.intent === "catalog_list" && parsed.data.requests.length === 1) {
    const request = parsed.data.requests[0]!;
    const productText = uniqueProductText([...explicit.aliases, ...explicit.nameTerms]);
    if (!request.productText && productText) request.productText = productText.slice(0, 200);
    request.specifications = uniqueProductTextValues([
      ...request.specifications, ...explicit.dimensions, ...explicit.specCodes,
    ]).slice(0, 12);
    if (!request.material && explicit.material) request.material = explicit.material;
  }
  return { ...parsed.data, understandingSource: "model" };
}

/** SQL-only degradation when the model is unavailable, never the normal planner. */
export function planCatalogFallback(question: string): RagQueryPlan | null {
  return createFamilyPricePlan(question) ?? createSpecificPricePlan(question)
    ?? createProductDiscoveryPlan(question) ?? createPurchaseCatalogPlan(question)
    ?? createNamedVariantListPlan(question) ?? createCatalogFactsPlan(question);
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
