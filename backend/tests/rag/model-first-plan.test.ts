import { expect, it, vi } from "vitest";
import { planRagQuery } from "../../src/rag/query-plan.js";

it.each(["tắc kê sắt 8 ly x 3f", "Tắc kê sắt 8 ly x 3F có quy cách gì?", "Bulong 8 ly x 3F có quy cách gì?"])("uses the model for catalog understanding: %s", async (question) => {
  const generate = vi.fn(async () => JSON.stringify({
    intent: "product_info", confidence: 0.95,
    requests: [{ intent: "product_info", productText: question.startsWith("Bulong") ? "Bulong" : "tắc kê sắt", specifications: ["8 ly x 3F"], requestedFields: ["facts"], constraints: [] }],
  }));
  const plan = await planRagQuery({ question, generate });
  expect(generate).toHaveBeenCalledOnce();
  expect(plan.intent).toBe("product_info");
});

it("accepts empty optional fields emitted by a local model without discarding a valid lookup", async () => {
  const plan = await planRagQuery({ question: "tắc kê sắt 8 ly x 3f", generate: async () => JSON.stringify({
    intent: "catalog_list", unresolvedFields: [""],
    requests: [{ intent: "catalog_list", productText: "", specifications: ["8 ly x 3f"], requestedFields: ["variants"], constraints: [] }],
  }) });
  expect(plan.intent).toBe("catalog_list");
  expect(plan.requests[0]?.productText).toBe("tắc kê");
});

it.each([
  "tôi muốn mua bulong, giới thiệu cho tôi",
  "tôi muốn mua bulong và hãy giới thiệu cho tôi",
  "giới thiệu cho tôi các sản phẩm bulong bên bạn",
])("asks the model to repair a missing identity using the whole sentence: %s", async (question) => {
  const generate = vi.fn()
    .mockResolvedValueOnce(JSON.stringify({ intent: "catalog_list", requests: [{ intent: "catalog_list", specifications: [], requestedFields: ["products"], constraints: [] }] }))
    .mockResolvedValueOnce(JSON.stringify({ intent: "catalog_list", requests: [{ intent: "catalog_list", productText: "bulong", specifications: [], requestedFields: ["products"], constraints: [] }] }));
  const plan = await planRagQuery({ question, generate });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[1]?.[0]).toMatchObject({ question, analysisFeedback: expect.any(String) });
  expect(plan.requests[0]?.productText).toBe("bulong");
});

it("does not retain a prior size when the current question names a product without a reference", async () => {
  const generate = vi.fn(async ({ context }: { context?: string[] }) => JSON.stringify({
    intent: "catalog_list", requests: [{ intent: "catalog_list", productText: "bulong", specifications: context?.length ? ["8 ly"] : [], requestedFields: ["products"], constraints: [] }],
  }));
  const plan = await planRagQuery({ question: "tôi muốn mua bulong, bạn có những sản phẩm nào", context: ["Giá bulong 8 ly x 3F"], generate });
  expect(plan.requests[0]?.specifications).toEqual([]);
  expect(generate).toHaveBeenLastCalledWith(expect.not.objectContaining({ context: expect.anything() }));
});

it("preserves model-understood prose measurements when re-reading a new question without old context", async () => {
  const plan = await planRagQuery({ question: "Giá bulong đường kính 8 dài 30?", context: ["Giá tắc kê sắt 10x80"], generate: async () => JSON.stringify({
    intent: "price_lookup", requests: [{ intent: "price_lookup", productText: "bulong", specifications: ["8x30"], requestedFields: ["price"], constraints: [] }],
  }) });
  expect(plan.requests[0]?.specifications).toEqual(["8x30"]);
});

it("retains prior dimensions when the model resolves an explicit product reference", async () => {
  const plan = await planRagQuery({ question: "loại đó giá sỉ bao nhiêu?", context: ["Bulong 8 ly x 3F"], generate: async () => JSON.stringify({
    intent: "price_lookup", requests: [{ intent: "price_lookup", productText: "bulong", specifications: ["8 ly x 3F"], previousReference: "loại đó", requestedFields: ["price"], constraints: [] }],
  }) });
  expect(plan.requests[0]?.specifications).toEqual(["8 ly x 3F"]);
});
