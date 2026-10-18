import type { SupabaseClient } from "@supabase/supabase-js";

export type CatalogPrice = {
  id: number; version: number; amount: number; price_type: string; minimum_quantity: number;
  active: boolean; valid_from: string; valid_to: string | null;
  price_lists: { name: string; effective_date: string; is_sample?: boolean; suppliers: { name: string; active?: boolean } | null } | null;
};

export type RagCatalogVariant = {
  product_id: number;
  attributes?: Record<string, unknown>;
  id: number;
  display_name: string;
  raw_specification: string | null;
  verification_status: string;
  products: { name: string; description?: string | null; categories: { name: string } | null; product_aliases: { alias: string }[] } | null;
  packaging_options: Array<{
    id: number; name: string; quantity: number; base_unit: string; note: string | null; prices: CatalogPrice[];
  }>;
  source_pages: number[];
};

export type RagCatalogPage = {
  items: RagCatalogVariant[];
  total: number;
  nextCursor: number | null;
};

type PublicCatalogRow = {
  attributes?: Record<string, unknown>;
  product_id: number; product_name: string; product_description?: string | null; category_name: string; product_aliases: string[] | null;
  variant_id: number; display_name: string; raw_specification: string | null; source_pages: number[] | null;
  packaging_id: number | null; packaging_name: string | null; package_quantity: number | null; unit: string | null; package_note: string | null;
  price_id: number | null; price_version: number | null; price_amount: number | null; price_type: string | null;
  minimum_quantity: number | null; price_list_name: string | null; supplier_name: string | null;
};

type ExistingPublicRow = Omit<PublicCatalogRow, "product_id" | "product_aliases"> & { product_id?: number; product_aliases?: string[]; product_description?: string | null; verification_status: string };

type PublicRpcResult = { data: RagCatalogVariant[] | null; error: unknown };

function groupPublicCatalogRows(rows: PublicCatalogRow[]): RagCatalogVariant[] {
  const variants = new Map<number, RagCatalogVariant>();
  for (const row of rows) {
    const variant = variants.get(row.variant_id) ?? {
      product_id: row.product_id,
      attributes: row.attributes ?? {},
      id: row.variant_id,
      display_name: row.display_name,
      raw_specification: row.raw_specification,
      verification_status: "verified",
      products: {
        name: row.product_name,
        description: row.product_description ?? null,
        categories: { name: row.category_name },
        product_aliases: (row.product_aliases ?? []).map((alias) => ({ alias })),
      },
      packaging_options: [],
      source_pages: row.source_pages ?? [],
    };
    if (row.packaging_id !== null) {
      let packaging = variant.packaging_options.find((option) => option.id === row.packaging_id);
      if (!packaging) {
        packaging = {
          id: row.packaging_id,
          name: row.packaging_name ?? "",
          quantity: Number(row.package_quantity ?? 0),
          base_unit: row.unit ?? "",
          note: row.package_note,
          prices: [],
        };
        variant.packaging_options.push(packaging);
      }
      if (row.price_id !== null && !packaging.prices.some((price) => price.id === row.price_id)) {
        packaging.prices.push({
          id: row.price_id,
          version: Number(row.price_version),
          amount: Number(row.price_amount),
          price_type: row.price_type ?? "retail",
          minimum_quantity: Number(row.minimum_quantity),
          active: true,
          valid_from: new Date(0).toISOString(),
          valid_to: null,
          price_lists: row.price_list_name ? {
            name: row.price_list_name,
            effective_date: "",
            suppliers: row.supplier_name ? { name: row.supplier_name } : null,
          } : null,
        });
      }
    }
    variants.set(row.variant_id, variant);
  }
  return [...variants.values()];
}

export function ragCatalogRepository(client: SupabaseClient, publicCatalogOnly = false) {
  return {
    searchCatalogPage: async (
      query: string,
      afterVariantId: number | null = null,
      pageSize = 20,
      categoryText: string | null = null,
    ): Promise<{ data: RagCatalogPage | null; error: unknown }> => {
      const functionName = publicCatalogOnly ? "list_public_rag_catalog_page" : "list_staff_rag_catalog_page";
      const { data, error } = await client.rpc(functionName, {
        p_query: query.trim(),
        p_category_text: categoryText?.trim() || null,
        p_after_variant_id: afterVariantId,
        p_page_size: Math.min(Math.max(Math.trunc(pageSize) || 20, 1), 50),
      });
      if (error || data === null) return { data: null, error };
      const payload = data as { items?: unknown; total_count?: unknown; next_cursor?: unknown };
      if (!Array.isArray(payload.items) || !Number.isInteger(Number(payload.total_count)) || Number(payload.total_count) < 0) {
        throw new Error("Catalog page RPC returned an invalid page payload.");
      }
      const items = payload.items as RagCatalogVariant[];
      if (items.some((item) => item.verification_status !== "verified")) {
        throw new Error("Catalog page RPC returned an ineligible variant.");
      }
      const nextCursor = payload.next_cursor === null || payload.next_cursor === undefined
        ? null
        : Number(payload.next_cursor);
      if (nextCursor !== null && (!Number.isSafeInteger(nextCursor) || nextCursor < 1)) {
        throw new Error("Catalog page RPC returned an invalid cursor.");
      }
      return {
        data: {
          items,
          total: Number(payload.total_count),
          nextCursor,
        },
        error: null,
      };
    },
    search: (question: string) => publicCatalogOnly
      ? client.rpc("search_public_rag_catalog", { p_query: question, p_result_limit: 8 })
      : client.rpc("search_catalog", { query: question, result_limit: 8, filter_category_id: null }),
    prices: async (ids: number[]) => {
      if (publicCatalogOnly) {
        const { data, error } = await client.rpc("get_public_rag_catalog", { p_variant_ids: ids });
        return { data: data ? groupExistingPublicRows(data as ExistingPublicRow[]) : null, error };
      }
      return client.from("product_variants").select(
        "id,product_id,display_name,raw_specification,attributes,verification_status,products!inner(name,description,categories!inner(name),product_aliases(alias)),packaging_options(id,name,quantity,base_unit,note,prices(id,version,amount,price_type,minimum_quantity,active,valid_from,valid_to,price_lists(name,effective_date,is_sample,suppliers(name,active))))",
      ).in("id", ids).eq("active", true).eq("verification_status", "verified").eq("products.active", true).eq("products.categories.active", true);
    },
    expandVerifiedGroups: async (seedVariantIds: number[]): Promise<PublicRpcResult> => {
      if (publicCatalogOnly) {
        const { data, error } = await client.rpc("list_public_rag_product_variants", { p_seed_variant_ids: seedVariantIds });
        return { data: data ? groupPublicCatalogRows(data as PublicCatalogRow[]) : null, error };
      }
      if (!seedVariantIds.length) return { data: [], error: null };
      const { data: seeds, error: seedError } = await client.from("product_variants")
        .select("product_id,products!inner(categories!inner(id))")
        .in("id", seedVariantIds)
        .eq("active", true)
        .eq("verification_status", "verified")
        .eq("products.active", true)
        .eq("products.categories.active", true);
      if (seedError) return { data: null, error: seedError };
      const productIds = [...new Set(((seeds ?? []) as Array<{ product_id: number }>).map((row) => row.product_id))];
      if (!productIds.length) return { data: [], error: null };
      const { data, error } = await client.from("product_variants").select(
        "id,product_id,display_name,raw_specification,attributes,verification_status,products!inner(name,categories!inner(name),product_aliases(alias)),packaging_options(id,name,quantity,base_unit,note,prices(id,version,amount,price_type,minimum_quantity,active,valid_from,valid_to,price_lists(name,effective_date,is_sample,suppliers(name,active)))),variant_sources(source_page_id)",
      ).in("product_id", productIds).eq("active", true).eq("verification_status", "verified").eq("products.active", true).eq("products.categories.active", true);
      if (error) return { data: null, error };
      const variants = (data ?? []) as unknown as RagCatalogVariant[];
      const { data: sources, error: sourceError } = await client.rpc("current_rag_variant_sources", {
        p_variant_ids: variants.map((variant) => variant.id),
      });
      if (sourceError) return { data: null, error: sourceError };
      const pages = new Map<number, Set<number>>();
      for (const source of (sources ?? []) as Array<{ product_variant_id: number; page_number: number | null }>) {
        if (source.page_number === null) continue;
        const variantPages = pages.get(source.product_variant_id) ?? new Set<number>();
        variantPages.add(source.page_number);
        pages.set(source.product_variant_id, variantPages);
      }
      return { data: variants.map((variant) => ({
        ...variant,
        source_pages: [...(pages.get(variant.id) ?? [])],
      })), error: null };
    },
    currentSources: (ids: number[]) => client.rpc(publicCatalogOnly ? "current_public_rag_variant_sources" : "current_rag_variant_sources", { p_variant_ids: ids }),
    verified: (start: number, end: number) => client.from("product_variants").select("id,display_name,raw_specification,search_text,attributes,products!inner(name,description,categories!inner(name),product_aliases(alias)),variant_sources(source_page_id,source_pages(page_number,verification_status)),packaging_options(name,quantity,base_unit,note)").eq("active", true).eq("verification_status", "verified").eq("products.active", true).eq("products.categories.active", true).order("id").range(start, end),
  };
}

function groupExistingPublicRows(rows: ExistingPublicRow[]): RagCatalogVariant[] {
  return groupPublicCatalogRows(rows.map((row) => ({
    ...row, product_id: row.product_id ?? 0, product_aliases: row.product_aliases ?? [],
  })));
}
