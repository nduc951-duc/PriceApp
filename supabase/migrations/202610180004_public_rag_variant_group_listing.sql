-- Expand verified retrieval seeds into one complete, public product group.
-- This scoped SECURITY DEFINER RPC keeps anonymous callers away from base tables
-- while exposing only current retail/wholesale price rows and eligible sources.
create or replace function public.list_public_rag_product_variants(p_seed_variant_ids bigint[])
returns table (
  product_id bigint,
  product_name text,
  category_name text,
  product_aliases text[],
  variant_id bigint,
  display_name text,
  raw_specification text,
  source_pages integer[],
  packaging_id bigint,
  packaging_name text,
  package_quantity numeric,
  unit text,
  package_note text,
  price_id bigint,
  price_version integer,
  price_amount numeric,
  price_type text,
  minimum_quantity numeric,
  price_list_name text,
  supplier_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with valid_seeds as (
    select distinct v.product_id
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.active
    join public.categories c on c.id = p.category_id and c.active
    where cardinality(coalesce(p_seed_variant_ids, '{}'::bigint[])) between 1 and 8
      and v.id = any(coalesce(p_seed_variant_ids, '{}'::bigint[]))
      and v.active and v.verification_status = 'verified'
  ), eligible_sources as (
    select distinct s.variant_id, page.page_number
    from public.variant_sources s
    join public.source_pages page on page.id = s.source_page_id
    left join public.rag_page_texts text on text.source_page_id = page.id
    where page.verification_status <> 'unreadable'
      and coalesce(text.review_status, 'draft') <> 'rejected'
  ), eligible_prices as (
    select pr.id, pr.packaging_id, pr.version, pr.amount, pr.price_type::text as price_type,
      pr.minimum_quantity, pl.name as price_list_name, supplier.name as supplier_name
    from public.prices pr
    join public.price_lists pl on pl.id = pr.price_list_id and not pl.is_sample
    join public.suppliers supplier on supplier.id = pl.supplier_id and supplier.active
    where pr.active and pr.price_type in ('retail', 'wholesale')
      and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
  )
  select p.id, p.name, c.name,
    coalesce((
      select array_agg(alias.alias order by alias.alias)
      from public.product_aliases alias where alias.product_id = p.id
    ), '{}'::text[]),
    v.id, v.display_name, v.raw_specification,
    coalesce((
      select array_agg(distinct source.page_number order by source.page_number)
      from eligible_sources source where source.variant_id = v.id and source.page_number is not null
    ), '{}'::integer[]),
    po.id, po.name, po.quantity, po.base_unit, coalesce(po.note, ''),
    price.id, price.version, price.amount, price.price_type,
    price.minimum_quantity, price.price_list_name, price.supplier_name
  from valid_seeds seed
  join public.products p on p.id = seed.product_id and p.active
  join public.categories c on c.id = p.category_id and c.active
  join public.product_variants v on v.product_id = p.id and v.active and v.verification_status = 'verified'
  left join public.packaging_options po on po.variant_id = v.id
  left join eligible_prices price on price.packaging_id = po.id
  order by v.id, po.quantity nulls last, price.price_type, price.minimum_quantity
$$;

revoke all on function public.list_public_rag_product_variants(bigint[]) from public, authenticated;
grant execute on function public.list_public_rag_product_variants(bigint[]) to anon;
