import { catalogSpecificationMeaning } from "./catalog-specification.js";

const formatVnd = (amount: number) => new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 2 }).format(amount);

export type Price = {
  amount: number; priceType: string; packagingName: string; minimumQuantity: number; packageNote?: string;
  packageQuantity?: number; unit?: string; priceList?: string | null; supplier?: string | null;
};
export type Item = { productName: string; category?: string; variant: string; sourcePages: number[]; prices: Price[] };

export function priceAnswer(items: Item[]): string {
  if (!items.some((item) => item.prices.length)) return "Chưa có giá hiện hành cho mặt hàng này trong cơ sở dữ liệu.";
  const number = new Intl.NumberFormat("vi-VN");
  return items.filter((item) => item.prices.length).map((item) => {
    const meaning = catalogSpecificationMeaning(item.variant, [item.productName, item.category]);
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
    return `${item.productName} — ${item.variant}: ${prices.join("; ")}.${meaning ? ` Diễn giải quy cách: ${meaning}.` : ""} Nguồn: ${source.join(" · ")}.`;
  }).join("\n");
}

/** Deterministic list/count response built only from catalog and current SQL price rows. */
export function variantListAnswer(items: Item[], requestedTier?: "retail" | "wholesale" | "dealer"): string {
  if (!items.length) return "Chưa tìm thấy quy cách đã xác minh phù hợp để liệt kê.";
  const productName = new Set(items.map((item) => item.productName)).size > 1 ? "Danh mục" : items[0]?.productName ?? "Mặt hàng";
  const lines = items.map((item) => {
    const missingPrice = requestedTier === "wholesale" ? "Chưa có giá sỉ hiện hành"
      : requestedTier === "dealer" ? "Chưa có giá đại lý hiện hành"
        : requestedTier === "retail" ? "Chưa có giá lẻ hiện hành"
          : "Chưa có giá hiện hành";
    const meaning = catalogSpecificationMeaning(item.variant, [item.productName, item.category]);
    const detail = item.prices.length
      ? priceAnswer([item])
      : `${item.productName} — ${item.variant}: ${missingPrice}.${meaning ? ` Diễn giải quy cách: ${meaning}.` : ""} Nguồn: ${item.sourcePages.length ? `trang ${item.sourcePages.join(", ")}` : "chưa có trang nguồn"}.`;
    return `• ${detail}`;
  });
  return `${productName} có ${items.length} quy cách đã xác minh:\n${lines.join("\n")}`;
}
