import type { SupabaseClient } from "@supabase/supabase-js";

type PublicCatalogRow = {
  variant_id: number; display_name: string; raw_specification: string | null; verification_status: string;
  product_name: string; category_name: string; source_pages: number[] | null;
  packaging_id: number; packaging_name: string; package_quantity: number; unit: string; package_note: string;
  price_id: number; price_version: number; price_amount: number; price_type: string; minimum_quantity: number;
  price_list_name: string | null; supplier_name: string | null;
};

function groupPublicCatalogRows(rows: PublicCatalogRow[]) {
  const variants = new Map<number, {
    id: number; display_name: string; raw_specification: string | null; verification_status: string;
    products: { name: string; categories: { name: string }; product_aliases: { alias: string }[] };
    packaging_options: Array<{ id: number; name: string; quantity: number; base_unit: string; note: string; prices: Array<Record<string, unknown>> }>;
  }>();
  for (const row of rows) {
    const variant = variants.get(row.variant_id) ?? {
      id: row.variant_id, display_name: row.display_name, raw_specification: row.raw_specification,
      verification_status: row.verification_status,
      products: { name: row.product_name, categories: { name: row.category_name }, product_aliases: [] },
      packaging_options: [],
    };
    let packaging = variant.packaging_options.find((option) => option.id === row.packaging_id);
    if (!packaging) {
      packaging = { id: row.packaging_id, name: row.packaging_name, quantity: row.package_quantity, base_unit: row.unit, note: row.package_note, prices: [] };
      variant.packaging_options.push(packaging);
    }
    packaging.prices.push({
      id: row.price_id, version: row.price_version, amount: row.price_amount, price_type: row.price_type,
      minimum_quantity: row.minimum_quantity, active: true, valid_from: new Date(0).toISOString(), valid_to: null,
      price_lists: row.price_list_name ? { name: row.price_list_name, effective_date: "", suppliers: row.supplier_name ? { name: row.supplier_name } : null } : null,
    });
    variants.set(row.variant_id, variant);
  }
  return [...variants.values()];
}

export function ragCatalogRepository(client: SupabaseClient, publicCatalogOnly = false) {
  return {
    search: (question: string) => publicCatalogOnly
      ? client.rpc("search_public_rag_catalog", { p_query: question, p_result_limit: 8 })
      : client.rpc("search_catalog", { query: question, result_limit: 8, filter_category_id: null }),
    prices: async (ids: number[]) => {
      if (publicCatalogOnly) {
        const { data, error } = await client.rpc("get_public_rag_catalog", { p_variant_ids: ids });
        return { data: data ? groupPublicCatalogRows(data as PublicCatalogRow[]) : null, error };
      }
      return client.from("product_variants").select(
      "id,display_name,raw_specification,verification_status,products!inner(name,categories(name),product_aliases(alias)),packaging_options(id,name,quantity,base_unit,note,prices(id,version,amount,price_type,minimum_quantity,active,valid_from,valid_to,price_lists(name,effective_date,suppliers(name))))",
      ).in("id", ids).eq("active", true).eq("verification_status", "verified");
    },
    currentSources: (ids: number[]) => client.rpc(publicCatalogOnly ? "current_public_rag_variant_sources" : "current_rag_variant_sources", { p_variant_ids: ids }),
    verified: (start: number, end: number) => client.from("product_variants").select("id,display_name,raw_specification,search_text,attributes,products!inner(name,categories(name),product_aliases(alias)),variant_sources(source_page_id,source_pages(page_number,verification_status)),packaging_options(name,quantity,base_unit,note)").eq("active", true).eq("verification_status", "verified").order("id").range(start, end),
  };
}
