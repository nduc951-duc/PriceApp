export function priceTierLabel(priceType: string): string {
  if (priceType === "wholesale") return "Giá sỉ";
  if (priceType === "dealer") return "Giá đại lý";
  return "Giá lẻ";
}
