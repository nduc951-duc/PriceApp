import { describe, expect, it } from "vitest";
import { hasInvoicePriceChanged } from "./invoice-price-review";

describe("invoice price review", () => {
  it("requires confirmation when the amount changes", () => {
    expect(hasInvoicePriceChanged({ price: 100, version: 1 }, { price: 120, version: 1 })).toBe(true);
  });

  it("requires confirmation when the version changes even if the amount is unchanged", () => {
    expect(hasInvoicePriceChanged({ price: 100, version: 1 }, { price: 100, version: 2 })).toBe(true);
  });

  it("requires confirmation when package quantity or unit changes", () => {
    expect(hasInvoicePriceChanged(
      { price: 100, version: 1, packagingId: 3, packageQuantity: 10, unit: "cái" },
      { price: 100, version: 1, packagingId: 3, packageQuantity: 12, unit: "cái" },
    )).toBe(true);
  });

  it("requires confirmation when package, tier, or minimum quantity changes", () => {
    expect(hasInvoicePriceChanged(
      { price: 100, version: 1, packageName: "bịch", priceType: "retail", minimumQuantity: 1 },
      { price: 100, version: 1, packageName: "hộp", priceType: "wholesale", minimumQuantity: 10 },
    )).toBe(true);
  });

  it("keeps an unchanged price version ready for the quote", () => {
    expect(hasInvoicePriceChanged({ price: 100, version: 2 }, { price: 100, version: 2 })).toBe(false);
  });
});
