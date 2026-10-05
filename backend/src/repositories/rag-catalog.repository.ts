import type { SupabaseClient } from "@supabase/supabase-js";

export function ragCatalogRepository(client: SupabaseClient) {
  return {
    search: (question: string) => client.rpc("search_catalog", { query: question, result_limit: 8, filter_category_id: null }),
    prices: (ids: number[]) => client.from("product_variants").select(
      "id,display_name,raw_specification,verification_status,products!inner(name,categories(name),product_aliases(alias)),packaging_options(id,name,quantity,base_unit,note,prices(id,amount,price_type,minimum_quantity,active,valid_from,valid_to,price_lists(name,effective_date,suppliers(name))))",
    ).in("id", ids).eq("active", true).eq("verification_status", "verified"),
    currentSources: (ids: number[]) => client.rpc("current_rag_variant_sources", { p_variant_ids: ids }),
    verified: (start: number, end: number) => client.from("product_variants").select("id,display_name,raw_specification,search_text,attributes,products!inner(name,categories(name),product_aliases(alias)),variant_sources(source_page_id,source_pages(page_number,verification_status))").eq("active", true).eq("verification_status", "verified").order("id").range(start, end),
  };
}
