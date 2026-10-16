type PriceSnapshot = {
  price: number;
  version: number;
  packagingId?: number;
  packageName?: string;
  packageQuantity?: number;
  unit?: string;
  minimumQuantity?: number;
  priceType?: string;
};

export function hasInvoicePriceChanged(saved: PriceSnapshot, current: PriceSnapshot): boolean {
  return saved.price !== current.price || saved.version !== current.version ||
    (saved.packagingId !== undefined && saved.packagingId !== current.packagingId) ||
    (saved.packageName !== undefined && saved.packageName !== current.packageName) ||
    (saved.packageQuantity !== undefined && saved.packageQuantity !== current.packageQuantity) ||
    (saved.unit !== undefined && saved.unit !== current.unit) ||
    (saved.minimumQuantity !== undefined && saved.minimumQuantity !== current.minimumQuantity) ||
    (saved.priceType !== undefined && saved.priceType !== current.priceType);
}
