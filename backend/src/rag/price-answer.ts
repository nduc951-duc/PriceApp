const formatVnd = (amount: number) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 2 }).format(amount);

type Price = {
  amount: number; priceType: string; packagingName: string; minimumQuantity: number; packageNote?: string;
  packageQuantity?: number; unit?: string; priceList?: string | null; supplier?: string | null;
};
type Item = { productName: string; variant: string; sourcePages: number[]; prices: Price[] };

export function priceAnswer(items: Item[]): string {
  if (!items.some((item) => item.prices.length)) return "Chưa có giá hiện hành cho mặt hàng này trong cơ sở dữ liệu.";
  const number = new Intl.NumberFormat("vi-VN");
  return items.filter((item) => item.prices.length).map((item) => {
    const prices = item.prices.map((price) => {
      const tier = price.priceType === "wholesale" ? "Giá sỉ" : price.priceType === "dealer" ? "Giá đại lý" : "Giá lẻ";
      const packageContents = price.packageQuantity && price.unit ? ` · ${number.format(price.packageQuantity)} ${price.unit}` : "";
      const threshold = price.priceType === "wholesale" && price.packageNote?.includes("Chưa rõ số lượng tối thiểu")
        ? "chưa xác nhận ngưỡng giá sỉ"
        : price.minimumQuantity > 1 ? `tối thiểu ${number.format(price.minimumQuantity)} ${price.packagingName}` : "";
      const contents = packageContents.replace(/^ · /, " · ");
      return `${tier}: ${formatVnd(price.amount)} / ${price.packagingName}${contents}${threshold ? ` (${threshold})` : ""}`;
    });
    const priceSources = [...new Set(item.prices.map((price) => [price.priceList, price.supplier].filter(Boolean).join(" · ")).filter(Boolean))];
    const source = [...priceSources, item.sourcePages.length ? `trang ${item.sourcePages.join(", ")}` : "chưa có trang nguồn"];
    return `${item.productName} — ${item.variant}: ${prices.join("; ")}. Nguồn: ${source.join(" · ")}.`;
  }).join("\n");
}
