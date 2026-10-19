import { describe, expect, it } from "vitest";
import { resolveVariantReference } from "../../src/rag/variant-reference.js";

describe("follow-up references against prior result IDs", () => {
  it.each([
    ["Giá loại thứ hai bao nhiêu?", [41, 42, 43], { kind: "resolved", variantIds: [42], ordinal: 2 }],
    ["Quy cách 3 thì sao?", [41, 42, 43], { kind: "resolved", variantIds: [43], ordinal: 3 }],
    ["Loại đầu tiên", [41, 42], { kind: "resolved", variantIds: [41], ordinal: 1 }],
  ] as const)("resolves %s only within the previous result", (question, ids, expected) => {
    expect(resolveVariantReference(question, [...ids])).toEqual(expected);
  });

  it("uses a single prior result for singular references and asks when several could match", () => {
    expect(resolveVariantReference("Cái đó giá sao?", [41])).toEqual({ kind: "resolved", variantIds: [41], ordinal: 1 });
    expect(resolveVariantReference("Mặt hàng đó giá sao?", [41, 42])).toEqual({ kind: "ambiguous", variantIds: [41, 42] });
  });

  it("supports referring to all or the other of a two-item comparison", () => {
    expect(resolveVariantReference("So sánh hai loại đó", [41, 42])).toEqual({ kind: "resolved", variantIds: [41, 42], ordinal: 0 });
    expect(resolveVariantReference("Còn loại kia?", [41, 42])).toEqual({ kind: "resolved", variantIds: [42], ordinal: 2 });
  });

  it("does not turn arbitrary or out-of-range text into an ID", () => {
    expect(resolveVariantReference("Cho tôi xem loại tắc kê", [41, 42])).toEqual({ kind: "none" });
    expect(resolveVariantReference("Loại thứ ba?", [41, 42])).toEqual({ kind: "missing", ordinal: 3 });
    expect(resolveVariantReference("Loại thứ hai", [41, 42, -1, 42])).toEqual({ kind: "resolved", variantIds: [42], ordinal: 2 });
  });
});
