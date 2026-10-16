import { describe, expect, it } from "vitest";
import { selectBestPrice } from "./select-price";

const rows = [
  { id: 1, price: 12000, packageQuantity: 10, minimumQuantity: 1, priceType: "retail", packageNote: "", unit: "con", status: "verified" as const },
  { id: 2, price: 90000, packageQuantity: 100, minimumQuantity: 1, priceType: "wholesale", packageNote: "", unit: "con", status: "verified" as const },
];

describe("selectBestPrice", () => {
  it("selects an exact package equivalent without changing its amount", () => {
    expect(selectBestPrice(rows, 10, 10)).toMatchObject({ item: rows[1], packageCount: 1, total: 90000 });
  });
  it("keeps the retail row for a smaller request", () => {
    expect(selectBestPrice(rows, 1, 10)).toMatchObject({ item: rows[0], packageCount: 1, total: 12000 });
  });
  it("does not offer a wholesale row with an unknown threshold", () => {
    const uncertain = [{ ...rows[1], packageNote: "Chưa rõ số lượng tối thiểu" }];
    expect(selectBestPrice(uncertain, 10, 10)).toBeNull();
  });
  it("requires an exact whole number of selected packages and the row minimum", () => {
    expect(selectBestPrice([{ ...rows[1], minimumQuantity: 2 }], 10, 10)).toBeNull();
    expect(selectBestPrice([{ ...rows[1], minimumQuantity: 2 }], 20, 10)?.total).toBe(180000);
    expect(selectBestPrice([{ ...rows[1], packageQuantity: 30 }], 10, 10)).toBeNull();
  });
  it("never recommends a cheaper price that has not been verified", () => {
    const unreviewed = { ...rows[0], id: 3, price: 100, status: "needs_review" as const };
    expect(selectBestPrice([unreviewed, rows[0]], 1, 10)).toMatchObject({
      item: rows[0],
      packageCount: 1,
      total: 12000,
    });
  });
});
