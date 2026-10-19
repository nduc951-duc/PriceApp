import { describe, expect, it } from "vitest";
import { formatMinimumPackageQuantity, formatPackageContents, getSellingUnitLabel } from "../../../../src/features/pricing/package-display";

describe("package display", () => {
  it.each(["bịch", "hộp", "cuộn"])("uses the catalog selling package name %s without substituting a generic package", packaging => {
    expect(getSellingUnitLabel(packaging)).toBe(packaging);
    expect(formatMinimumPackageQuantity(5, packaging, 10, "bộ")).toBe(`Tối thiểu 5 ${packaging} (50 bộ)`);
  });

  it("formats contained quantity only from explicit package metadata", () => {
    expect(formatPackageContents(10, "bộ")).toBe("10 bộ");
    expect(formatPackageContents(0, "bộ")).toBeNull();
    expect(formatPackageContents(10, " ")).toBeNull();
  });

  it("does not guess a package label or base-unit conversion when metadata is missing", () => {
    expect(getSellingUnitLabel("  ")).toBeNull();
    expect(formatMinimumPackageQuantity(3, "", 10, "bộ")).toBe("Tối thiểu 3 đơn vị bán");
    expect(formatMinimumPackageQuantity(3, "hộp", 10, "")).toBe("Tối thiểu 3 hộp");
  });
});
