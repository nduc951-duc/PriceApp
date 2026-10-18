import { describe, expect, it, vi } from "vitest";
import { RagProviderUnavailableError } from "./provider.js";

async function loadQueryPlanner() {
  const loaded = await import(/* @vite-ignore */ new URL("./query-plan.ts", import.meta.url).href).catch(() => null);
  expect(loaded, "the flexible query planner should be available").not.toBeNull();
  return loaded;
}

describe("validated RAG query planning", () => {
  it.each([
    { question: "silicon a500", name: "silicon", code: "a500" },
    { question: "silicone A300", name: "silicone", code: "A300" },
  ])("retains explicit product identity when the model drops filters: $question", async ({ question, name, code }) => {
    const planner = await loadQueryPlanner();
    const plan = await planner!.planRagQuery({ question, generate: async () => JSON.stringify({
      intent: "catalog_list", requests: [{ intent: "catalog_list", specifications: [], requestedFields: ["variants"], constraints: [] }],
    }) });
    expect(plan.requests[0]).toMatchObject({ productText: name, specifications: [code] });
  });

  it("retains an explicit model code even if the planner only keeps the product name", async () => {
    const planner = await loadQueryPlanner();
    const plan = await planner!.planRagQuery({ question: "silicon a500", generate: async () => JSON.stringify({
      intent: "catalog_list", requests: [{ intent: "catalog_list", productText: "silicon", specifications: [], requestedFields: ["variants"], constraints: [] }],
    }) });
    expect(plan.requests[0]?.specifications).toContain("a500");
  });
  it("routes specification and packaging questions without a chat model", async () => {
    const planner = await loadQueryPlanner();
    const generate = vi.fn(async () => { throw new Error("chat offline"); });
    const plan = await planner!.planRagQuery({ question: "Quy cách tắc kê sắt 8x60", generate });
    expect(plan).toMatchObject({ intent: "product_info", requests: [{ requestedFields: ["facts"] }] });
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects a singular intent that disagrees with the requested operation", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const plan = await planner.planRagQuery({
      question: "Tìm tắc kê giúp tôi",
      generate: async () => JSON.stringify({
        intent: "price_lookup",
        requests: [{ intent: "advice", productText: "tắc kê", specifications: [], requestedFields: ["suitability"], constraints: [] }],
        confidence: 0.99,
      }),
    });
    expect(plan.intent).toBe("clarification");
    expect(plan.requests).toEqual([]);
  });

  it("uses the fast path for a specific singular price question without calling the model", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => "{}");

    const plan = await planner.planRagQuery({
      question: "Tắc kê sắt 6x50 giá bao nhiêu?",
      generate,
    });

    expect(plan).toMatchObject({
      intent: "price_lookup",
      requests: [{ intent: "price_lookup", specifications: ["6x50"], requestedFields: ["price"] }],
      confidence: 0.95,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("lists current prices for an incomplete scalar size instead of treating it as one exact variant", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => "{}");

    const plan = await planner.planRagQuery({
      question: "Giá sỉ tắc kê sắt 8 ly là bao nhiêu?",
      generate,
    });

    expect(plan).toMatchObject({
      intent: "catalog_list",
      requests: [{
        intent: "catalog_list",
        productText: "tắc kê",
        material: "sắt",
        specifications: ["8 ly"],
        requestedFields: ["variants", "price"],
        priceTier: "wholesale",
      }],
      confidence: 0.95,
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("handles alternate family-list wording generically", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;

    const plan = await planner.planRagQuery({ question: "Báo giá các quy cách bulong 8 mm" });

    expect(plan).toMatchObject({
      intent: "catalog_list",
      requests: [{ productText: "bulong", specifications: ["8 mm"], requestedFields: ["variants", "price"] }],
    });
  });

  it("routes a named product list question deterministically even if the model misclassifies it", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => JSON.stringify({
      intent: "product_info",
      requests: [{ intent: "product_info", productText: "bulong", specifications: [], requestedFields: ["facts"], constraints: [] }],
      confidence: 0.9,
    }));

    const plan = await planner.planRagQuery({ question: "Bulong có những quy cách gì?", generate });

    expect(plan).toMatchObject({
      intent: "catalog_list",
      requests: [{ intent: "catalog_list", productText: "Bulong", requestedFields: ["variants"] }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps an explicitly requested partial dimension when listing product variants", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => "{}");

    const plan = await planner.planRagQuery({ question: "Bulong 8 ly có quy cách gì?", generate });

    expect(plan).toMatchObject({
      intent: "catalog_list",
      requests: [{ intent: "catalog_list", productText: "Bulong", specifications: ["8 ly"], requestedFields: ["variants"] }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("plans a product-family discovery question as parent products rather than variant specifications", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => "{}");

    const plan = await planner.planRagQuery({
      question: "tôi muốn mua tắc kê, bên bạn có những sản phẩm gì về tắc kê",
      generate,
    });

    expect(plan).toMatchObject({
      intent: "catalog_list",
      requests: [{ intent: "catalog_list", productText: "tắc kê", requestedFields: ["products"] }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("turns a simple purchase request into verified catalog options for the named material family", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => "{}");

    const plan = await planner.planRagQuery({ question: "Tôi muốn mua tắc kê sắt", generate });

    expect(plan).toMatchObject({
      intent: "catalog_list",
      requests: [{ intent: "catalog_list", productText: "tắc kê", material: "sắt", specifications: [], requestedFields: ["variants", "price"] }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("ignores conversational availability wording when extracting a purchase product", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => "{}");

    const plan = await planner.planRagQuery({
      question: "Tôi muốn mua tắc kê sắt, bạn có không",
      generate,
    });

    expect(plan).toMatchObject({
      intent: "catalog_list",
      requests: [{ intent: "catalog_list", productText: "tắc kê", material: "sắt", specifications: [], requestedFields: ["variants", "price"] }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("removes the customer address from a product-family discovery question", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => "{}");

    const plan = await planner.planRagQuery({ question: "Bạn có sản phẩm gì về tắc kê?", generate });

    expect(plan).toMatchObject({
      intent: "catalog_list",
      requests: [{ intent: "catalog_list", productText: "tắc kê", requestedFields: ["products"] }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps specification separators out of the product name in a bolt facts question", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => "{}");

    const plan = await planner.planRagQuery({ question: "Thông tin bulong 8 ly x 1F5", generate });

    expect(plan).toMatchObject({
      intent: "product_info",
      requests: [{ intent: "product_info", productText: "bulong", specifications: ["8 ly", "1F5"], requestedFields: ["facts"] }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("removes a conversational question ending from a packaging facts question", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => "{}");

    const plan = await planner.planRagQuery({ question: "Đóng gói tắc kê sắt 8x100 thế nào?", generate });

    expect(plan).toMatchObject({
      intent: "product_info",
      requests: [{ intent: "product_info", productText: "tắc kê", material: "sắt", specifications: ["8x100"], requestedFields: ["facts"] }],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses the model plan for an unconstrained multi-intent catalog question", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generated = JSON.stringify({
      intent: "multi_intent",
      requests: [
        { intent: "catalog_list", productText: "tắc kê đạn", specifications: [], requestedFields: ["variants"], constraints: [] },
        { intent: "price_lookup", productText: "tắc kê đạn", specifications: [], requestedFields: ["price", "unit"], constraints: [] },
      ],
      confidence: 0.93,
    });
    const generate = vi.fn(async () => generated);

    const plan = await planner.planRagQuery({
      question: "Cửa hàng có bao nhiêu loại tắc kê đạn, giá từng quy cách ra sao?",
      generate,
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(plan).toMatchObject({ intent: "multi_intent", requests: [{ intent: "catalog_list" }, { intent: "price_lookup" }] });
    expect(JSON.stringify(plan)).not.toMatch(/priceId|amount|sourceUrl|toolCall/i);
  });

  it("preserves stated quantity, price tier, and reference text as untrusted query constraints", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const plan = await planner.planRagQuery({
      question: "Lấy giúp tôi 12 cái loại vừa, giá sỉ",
      context: ["Hỏi về tắc kê đạn 8 ly"],
      generate: async () => JSON.stringify({
        intent: "price_lookup",
        requests: [{
          intent: "price_lookup",
          productText: "tắc kê đạn",
          specifications: ["8 ly"],
          requestedFields: ["price", "unit"],
          priceTier: "wholesale",
          requestedQuantity: { amount: 12, unit: "cái" },
          constraints: [],
          previousReference: "loại vừa",
        }],
        confidence: 0.92,
      }),
    });

    expect(plan).toMatchObject({
      intent: "price_lookup",
      requests: [{
        priceTier: "wholesale",
        requestedQuantity: { amount: 12, unit: "cái" },
        previousReference: "loại vừa",
      }],
    });
  });

  it("does not accept a comparison plan with only one candidate", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const plan = await planner.planRagQuery({
      question: "So sánh tắc kê 8 ly",
      generate: async () => JSON.stringify({
        intent: "comparison",
        requests: [{ intent: "comparison", productText: "tắc kê 8 ly", specifications: ["8 ly"], requestedFields: ["facts"], constraints: [] }],
        confidence: 0.9,
      }),
    });

    expect(plan.intent).toBe("clarification");
    expect(plan.requests).toEqual([]);
  });

  it("retains a spoken category as a text filter instead of accepting a generated database ID", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const plan = await planner.planRagQuery({
      question: "Trong nhóm tắc kê, cửa hàng có những quy cách nào?",
      generate: async () => JSON.stringify({
        intent: "catalog_list",
        requests: [{
          intent: "catalog_list",
          productText: "tắc kê",
          categoryText: "tắc kê",
          specifications: [],
          requestedFields: ["variants"],
          constraints: [],
        }],
        confidence: 0.88,
      }),
    });

    expect(plan.requests[0]).toMatchObject({ categoryText: "tắc kê" });
    expect(JSON.stringify(plan)).not.toMatch(/categoryId|productId|variantId/i);
  });

  it("asks for one clarification when the planner confidence is below threshold", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    const generate = vi.fn(async () => JSON.stringify({
      intent: "price_lookup",
      requests: [{ intent: "price_lookup", productText: "tắc kê", specifications: [], requestedFields: ["price"], constraints: [] }],
      confidence: 0.2,
    }));

    const plan = await planner.planRagQuery({ question: "Tắc kê loại nào giá bao nhiêu?", generate });

    expect(plan.intent).toBe("clarification");
    expect(plan.requests).toEqual([]);
    expect(plan.clarificationQuestion).toBeTruthy();
  });

  it("falls back safely for malformed or tool-shaped model output", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;
    for (const output of ["not json", JSON.stringify({
      intent: "price_lookup",
      requests: [{ intent: "price_lookup", productText: "tắc kê", specifications: [], requestedFields: ["price"], constraints: [], toolCall: "read_any_table" }],
      confidence: 0.99,
    })]) {
      const plan = await planner.planRagQuery({ question: "Tắc kê giá bao nhiêu?", generate: async () => output });
      expect(plan.intent).toBe("clarification");
      expect(plan.requests).toEqual([]);
    }
  });

  it("returns a safe clarification when the model provider is unavailable", async () => {
    const planner = await loadQueryPlanner();
    if (!planner) return;

    const plan = await planner.planRagQuery({
      question: "Tư vấn giúp tôi chọn vật tư lắp kệ ngoài trời",
      generate: async () => { throw new RagProviderUnavailableError(); },
    });

    expect(plan.intent).toBe("clarification");
    expect(plan.requests).toEqual([]);
    expect(plan.clarificationQuestion).toBeTruthy();
  });
});
