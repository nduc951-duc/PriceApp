import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import type { CatalogEntry, CatalogPrice, CatalogResponse } from "../schemas/catalog.schema.js";

type PriceRow = { id: number; amount: number | string; version: number; price_type: string; minimum_quantity: number | string; active: boolean; valid_from: string; valid_to: string | null; price_lists: { suppliers: { name: string } | null } | null };
type PackageRow = { id: number; name: string; quantity: number | string; base_unit: string; note: string | null; prices: PriceRow[] | null };
type VariantRow = {
  id: number; active: boolean; display_name: string; raw_specification: string | null;
  verification_status: CatalogPrice["status"] | "sample";
  products: { id: number; name: string; categories: { id: number; name: string } | null } | null;
  packaging_options: PackageRow[] | null;
  variant_sources: { source_pages: { page_number: number | null; storage_path: string | null } | null }[] | null;
};

export function mapCatalogRows(rows: VariantRow[], now = Date.now()): Pick<CatalogResponse, "entries" | "prices"> {
  const entries: CatalogEntry[] = [];
  const prices: CatalogPrice[] = [];
  for (const variant of rows) {
    if (!variant.active || variant.verification_status === "sample") continue;
    const sources = variant.variant_sources ?? [];
    const sourcePages = sources.map(source => source.source_pages?.page_number).filter((page): page is number => page != null);
    const sourceFiles = sources.map(source => source.source_pages?.storage_path).filter((path): path is string => Boolean(path));
    const name = variant.products?.name ?? variant.display_name;
    const category = variant.products?.categories?.name ?? "Chưa phân nhóm";
    const spec = variant.raw_specification ?? variant.display_name;
    const common = { categoryId: variant.products?.categories?.id ?? 0, productId: variant.products?.id ?? 0,
      variantId: variant.id, name, category, sourcePages, sourceFiles };
    entries.push({ ...common, spec, displayName: variant.display_name });
    for (const pack of variant.packaging_options ?? []) {
      for (const price of pack.prices ?? []) {
        const validFrom = Date.parse(price.valid_from);
        const validTo = price.valid_to === null ? null : Date.parse(price.valid_to);
        if (!price.active || !Number.isFinite(validFrom) || validFrom > now ||
            (validTo !== null && (!Number.isFinite(validTo) || validTo < now))) continue;
        prices.push({ ...common, id: price.id, priceId: price.id, packagingId: pack.id,
          variantDisplayName: variant.display_name, spec: `${spec} • ${pack.name}`, variantSpec: spec,
          packageName: pack.name, packageQuantity: Number(pack.quantity), packageNote: pack.note ?? "",
          priceType: price.price_type, minimumQuantity: Number(price.minimum_quantity), price: Number(price.amount),
          unit: pack.base_unit, supplier: price.price_lists?.suppliers?.name ?? "Chưa rõ nhà cung cấp",
          status: variant.verification_status, version: price.version });
      }
    }
  }
  return { entries, prices };
}

export async function readCatalog(client: SupabaseClient): Promise<CatalogResponse> {
  const pageSize = 500;
  const rows: VariantRow[] = [];
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await client.from("product_variants").select(`
      id, active, display_name, raw_specification, verification_status,
      products!inner(id, name, categories!inner(id, name)),
      variant_sources(source_pages(page_number, storage_path)),
      packaging_options(id, name, quantity, base_unit, note,
        prices(id, amount, version, price_type, minimum_quantity, active, valid_from, valid_to, price_lists(suppliers(name))))
    `).eq("active", true).neq("verification_status", "sample").order("id", { ascending: true }).range(start, start + pageSize - 1);
    if (error) throw new ApiError(503, "INTERNAL_ERROR", "Catalog unavailable");
    const page = (data ?? []) as unknown as VariantRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { ...mapCatalogRows(rows), syncedAt: new Date().toISOString() };
}
