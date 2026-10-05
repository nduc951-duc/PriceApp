export type PricedPackage = {
  price: number;
  packageQuantity: number;
  minimumQuantity: number;
  priceType: string;
  packageNote: string;
  unit: string;
};

export function selectBestPrice<T extends PricedPackage>(
  rows: T[],
  smallestPackageCount: number,
  smallestPackageQuantity: number,
): { item: T; packageCount: number; total: number } | null {
  if (!Number.isSafeInteger(smallestPackageCount) || smallestPackageCount < 1 ||
      !Number.isFinite(smallestPackageQuantity) || smallestPackageQuantity <= 0) return null;
  const baseQuantity = smallestPackageCount * smallestPackageQuantity;
  const candidates = rows.flatMap((item) => {
    if (!Number.isFinite(item.packageQuantity) || item.packageQuantity <= 0 ||
        !Number.isFinite(item.price) || item.price < 0 ||
        (item.priceType === "wholesale" && item.packageNote.includes("Chưa rõ số lượng tối thiểu"))) return [];
    const packageCount = baseQuantity / item.packageQuantity;
    if (!Number.isSafeInteger(packageCount) || packageCount < Math.max(1, item.minimumQuantity)) return [];
    return [{ item, packageCount, total: packageCount * item.price }];
  });
  return candidates.sort((a, b) => a.total - b.total || a.item.packageQuantity - b.item.packageQuantity)[0] ?? null;
}
