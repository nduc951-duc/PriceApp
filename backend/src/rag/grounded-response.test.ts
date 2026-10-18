import { describe, expect, it } from "vitest";
import { hasRequiredResponseKinds } from "./grounded-response.js";

async function loadResponseValidator() {
  const loaded = await import(/* @vite-ignore */ new URL("./grounded-response.ts", import.meta.url).href).catch(() => null);
  expect(loaded, "grounded response validation should be available").not.toBeNull();
  return loaded;
}

const packet = {
  role: "customer",
  entries: [
    { id: "variant:1", kind: "catalog", variantId: 1, productName: "Tắc kê", variant: "6x50" },
    { id: "variant:2", kind: "catalog", variantId: 2, productName: "Tắc kê", variant: "8x60" },
    { id: "chunk:501", kind: "document", variantId: 1, excerpt: "Thông tin đã xác minh", pageNumber: 11 },
    { id: "chunk:502", kind: "document", variantId: 2, excerpt: "Quy cách thứ hai đã xác minh", pageNumber: 12 },
    { id: "price:101", kind: "price", variantId: 1, priceId: 101, amount: 34000, unit: "cái" },
  ],
  catalogPage: { total: 2, nextCursor: null, complete: true },
};

describe("validated grounded response blocks", () => {
  it("permits exact numeric catalog facts but rejects invented measurements", async () => {
    const validator = await loadResponseValidator();
    const facts = { ...packet, entries: packet.entries.map(entry => entry.id === "chunk:501" ? { ...entry, excerpt: "Đường kính 8 mm; dài 60 mm." } : entry) };
    const response = (text: string) => JSON.stringify({ blocks: [{ kind: "narrative", text, evidenceIds: ["variant:1", "chunk:501"] }] });
    expect(validator!.validateGroundedResponse(response("Đường kính 8 mm; dài 60 mm."), facts).valid).toBe(true);
    expect(validator!.validateGroundedResponse(response("Đường kính 10 mm."), facts).valid).toBe(false);
    expect(validator!.validateGroundedResponse(response("Dài 8 mm; đường kính 60 mm."), facts).valid).toBe(false);
  });
  it("accepts natural text only when each factual block cites evidence in the packet", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;

    const result = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "narrative", text: "Mình tìm thấy mặt hàng phù hợp; thông tin chi tiết được trình bày bên dưới.", evidenceIds: ["variant:1", "chunk:501"] }],
    }), packet);

    expect(result).toMatchObject({ valid: true, blocks: [{ kind: "narrative", evidenceIds: ["variant:1", "chunk:501"] }] });
  });

  it("rejects unknown evidence and model-produced price, unit, or page numbers", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;
    const invalid = [
      { blocks: [{ kind: "narrative", text: "Thông tin đã kiểm tra.", evidenceIds: ["chunk:does-not-exist"] }] },
      { blocks: [{ kind: "narrative", text: "Giá là 34.000₫ / cái.", evidenceIds: ["price:101"] }] },
      { blocks: [{ kind: "narrative", text: "Xem ở trang 11.", evidenceIds: ["chunk:501"] }] },
    ];

    for (const raw of invalid) {
      const result = validator.validateGroundedResponse(JSON.stringify(raw), packet);
      expect(result.valid).toBe(false);
    }
  });

  it("requires cited catalog identity when prose names a known product", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;

    const result = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "narrative", text: "Tắc kê đã được tìm thấy.", evidenceIds: ["chunk:501"] }],
    }), packet);

    expect(result).toMatchObject({ valid: false, reason: "unknown_variant" });
  });

  it("requires verified document evidence for factual narrative and recommendation blocks", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;
    const narrative = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "narrative", text: "Thông tin này có căn cứ.", evidenceIds: ["variant:1"] }],
    }), packet);
    const recommendation = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "recommendation", text: "Lựa chọn này phù hợp với nhu cầu đã nêu.", variantIds: [1], evidenceIds: ["variant:1"] }],
    }), packet);

    expect(narrative).toMatchObject({ valid: false, reason: "missing_fact_evidence" });
    expect(recommendation).toMatchObject({ valid: false, reason: "missing_fact_evidence" });
  });

  it("only accepts advice when the cited variant document supports the requested constraints", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;
    const advisedPacket = {
      ...packet,
      entries: packet.entries.map((entry) => entry.id === "chunk:501"
        ? { ...entry, excerpt: "Verified application: outdoor installation, water resistance." }
        : entry),
    };
    const response = JSON.stringify({
      blocks: [{ kind: "recommendation", text: "The documented option matches the stated conditions.", variantIds: [1], evidenceIds: ["variant:1", "chunk:501"] }],
    });

    expect(validator.validateGroundedResponse(response, advisedPacket, { requiredDocumentTerms: ["outdoor installation", "water resistance"] }).valid).toBe(true);
    expect(validator.validateGroundedResponse(response, packet, { requiredDocumentTerms: ["outdoor installation", "water resistance"] }))
      .toMatchObject({ valid: false, reason: "missing_fact_evidence" });
  });

  it("requires the structured block that matches the requested operation", () => {
    const narrative = [{ kind: "narrative" as const, text: "The evidence is listed below.", evidenceIds: ["chunk:501"] }];
    const comparison = [{ kind: "comparison" as const, text: "The two documented options differ.", variantIds: [1, 2], evidenceIds: ["variant:1", "variant:2", "chunk:501", "chunk:502"] }];
    const recommendation = [{ kind: "recommendation" as const, text: "The documented option meets the stated facts.", variantIds: [1], evidenceIds: ["variant:1", "chunk:501"] }];

    expect(hasRequiredResponseKinds(narrative, ["comparison"])).toBe(false);
    expect(hasRequiredResponseKinds(comparison, ["comparison"])).toBe(true);
    expect(hasRequiredResponseKinds(recommendation, ["recommendation"])).toBe(true);
  });

  it("requires two evidence-backed candidates for comparisons and validates every variant ID", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;

    const valid = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "comparison", text: "Hai quy cách khác nhau; đặc điểm có căn cứ được nêu bên dưới.", variantIds: [1, 2], evidenceIds: ["variant:1", "variant:2", "chunk:501", "chunk:502"] }],
    }), packet);
    const invalid = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "comparison", text: "Mình đã so sánh các lựa chọn.", variantIds: [1, 99], evidenceIds: ["variant:1", "variant:2", "chunk:501", "chunk:502"] }],
    }), packet);

    expect(valid.valid).toBe(true);
    expect(invalid).toMatchObject({ valid: false, reason: "unknown_variant" });
  });

  it("requires every compared variant to document the requested comparison dimension", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;
    const result = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "comparison", text: "The two options differ in their documented material.", variantIds: [1, 2], evidenceIds: ["variant:1", "variant:2", "chunk:501", "chunk:502"] }],
    }), packet, { requiredDocumentTerms: ["material composition"] });

    expect(result).toMatchObject({ valid: false, reason: "missing_fact_evidence" });
  });

  it("does not let generated prose claim a complete list when the packet has another page", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;
    const partialPacket = { ...packet, catalogPage: { total: 12, nextCursor: 2, complete: false } };

    const result = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "narrative", text: "Day la tat ca quy cach phu hop.", evidenceIds: ["variant:1", "chunk:501"] }],
    }), partialPacket);

    expect(result).toMatchObject({ valid: false, reason: "unsupported_completeness_claim" });
  });

  it("rejects accented Vietnamese completeness claims on a partial catalog page", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;
    const result = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "narrative", text: "Đây là tất cả quy cách phù hợp.", evidenceIds: ["variant:1", "chunk:501"] }],
    }), { ...packet, catalogPage: { total: 12, nextCursor: 2, complete: false } });
    expect(result).toMatchObject({ valid: false, reason: "unsupported_completeness_claim" });
  });

  it("rejects generated accented price language even when its amount is written in words", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;
    const result = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "narrative", text: "Giá là mười nghìn đồng.", evidenceIds: ["variant:1", "chunk:501"] }],
    }), packet);
    expect(result).toMatchObject({ valid: false, reason: "unsupported_authoritative_value" });
  });

  it("rejects JSON with arbitrary action or identifier fields", async () => {
    const validator = await loadResponseValidator();
    if (!validator) return;

    const result = validator.validateGroundedResponse(JSON.stringify({
      blocks: [{ kind: "narrative", text: "Mình đã tạo đơn.", evidenceIds: ["variant:1"], createOrder: true }],
    }), packet);

    expect(result).toMatchObject({ valid: false, reason: "invalid_schema" });
  });
});
