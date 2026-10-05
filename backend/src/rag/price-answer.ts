const formatVnd = (amount: number) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(amount);

type Price = { amount: number; priceType: string; packagingName: string; minimumQuantity: number; packageNote?: string };
type Item = { productName: string; variant: string; sourcePages: number[]; prices: Price[] };

export function priceAnswer(items: Item[]): string {
  if (!items.some((item) => item.prices.length)) return "Chưa có giá hiện hành cho mặt hàng này trong cơ sở dữ liệu.";
  return items.flatMap((item) => item.prices.map((price) => {
    const tier = price.priceType === "wholesale" ? "Giá sỉ" : price.priceType === "dealer" ? "Giá đại lý" : "Giá lẻ";
    const source = item.sourcePages.length ? `; nguồn trang ${item.sourcePages.join(", ")}` : "; chưa có trang nguồn";
    const threshold = price.priceType === "wholesale" && price.packageNote?.includes("Chưa rõ số lượng tối thiểu")
      ? "chưa xác nhận ngưỡng áp dụng giá sỉ"
      : `tối thiểu ${price.minimumQuantity} gói`;
    return `${item.productName} ${item.variant}: ${tier}, ${price.packagingName}: ${formatVnd(price.amount)}/gói (${threshold}${source}).`;
  })).join("\n");
}
