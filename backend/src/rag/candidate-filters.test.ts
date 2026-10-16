import { describe, expect, it } from "vitest";
import { matchesExplicitQuery } from "./candidate-filters.js";

describe("explicit query filters for catalog candidates", () => {
  it("rejects a nearby dimension and retains an exact one", () => {
    const query = "vít 8 ly";
    expect(matchesExplicitQuery({ productName: "Vít", variant: "10 ly", packages: [] }, query)).toBe(false);
    expect(matchesExplicitQuery({ productName: "Vít", variant: "8 ly", packages: [] }, query)).toBe(true);
  });

  it("checks explicit package, unit, and active price tier together", () => {
    const candidate = { productName: "Tắc kê", variant: "6x50", packages: [{ name: "bịch 10 cái", unit: "cái", activeTiers: ["wholesale"] }] };
    expect(matchesExplicitQuery(candidate, "tắc kê 6x50 bịch 10 cái, giá sỉ")).toBe(true);
    expect(matchesExplicitQuery(candidate, "tắc kê 6x50 hộp 10 cái, giá sỉ")).toBe(false);
    expect(matchesExplicitQuery({ ...candidate, packages: [{ ...candidate.packages[0]!, activeTiers: ["retail"] }] }, "tắc kê 6x50 bịch 10 cái, giá sỉ")).toBe(false);
  });

  it("does not require attributes that the question did not specify", () => {
    expect(matchesExplicitQuery({ productName: "Tắc kê", variant: "6x50", packages: [] }, "tắc kê")).toBe(true);
  });
});
