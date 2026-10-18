function formatQuantity(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 12 }).format(value);
}

export function getSellingUnitLabel(packaging: string | null | undefined): string | null {
  const label = packaging?.trim();
  return label || null;
}

export function formatPackageContents(packageQuantity: number, unit: string | null | undefined): string | null {
  const quantity = formatQuantity(packageQuantity);
  const unitLabel = unit?.trim();
  return quantity && unitLabel ? `${quantity} ${unitLabel}` : null;
}

export function formatMinimumPackageQuantity(
  minimumQuantity: number,
  packaging: string | null | undefined,
  packageQuantity: number,
  unit: string | null | undefined,
): string | null {
  const minimum = formatQuantity(minimumQuantity);
  if (!minimum) return null;

  const packageLabel = getSellingUnitLabel(packaging);
  const sellingUnit = packageLabel ?? "đơn vị bán";
  const equivalent = packageLabel ? formatPackageContents(minimumQuantity * packageQuantity, unit) : null;
  return `Tối thiểu ${minimum} ${sellingUnit}${equivalent ? ` (${equivalent})` : ""}`;
}
