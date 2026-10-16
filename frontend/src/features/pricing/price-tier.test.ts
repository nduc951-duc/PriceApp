import { describe, expect, it } from "vitest";
import { priceTierLabel } from "./price-tier";

describe("price tier labels", () => {
  it("names each configured price type explicitly", () => {
    expect(priceTierLabel("retail")).toBe("Giá lẻ");
    expect(priceTierLabel("wholesale")).toBe("Giá sỉ");
    expect(priceTierLabel("dealer")).toBe("Giá đại lý");
  });
});
