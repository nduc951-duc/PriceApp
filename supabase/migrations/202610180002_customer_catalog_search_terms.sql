-- Expose only the SKU and existing public product aliases through the existing
-- customer catalog RPC so the browser can filter locally without invoking RAG.
-- The function's execution grants remain unchanged.

drop function if exists public.get_public_customer_catalog();

create function public.get_public_customer_catalog()
returns table (
  category text,
  product_name text,
  variant_name text,
  specification text,
  product_code text,
  aliases text[],
  packaging_name text,
  package_quantity numeric,
  unit text,
  price_id bigint,
  price_version int,
  price_type text,
  minimum_quantity numeric,
  amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select c.name, p.name, v.display_name, coalesce(v.raw_specification, v.display_name),
    v.sku,
    coalesce((
      select array_agg(alias.alias order by alias.alias)
      from public.product_aliases alias
      where alias.product_id = p.id
    ), '{}'::text[]),
    po.name, po.quantity, po.base_unit, pr.id, pr.version, pr.price_type,
    pr.minimum_quantity, pr.amount
  from public.prices pr
  join public.packaging_options po on po.id = pr.packaging_id
  join public.product_variants v on v.id = po.variant_id
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  join public.price_lists pl on pl.id = pr.price_list_id
  where c.active and p.active and v.active and v.verification_status = 'verified'
    and pr.active and not pl.is_sample and pr.price_type in ('retail', 'wholesale')
    and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
  order by c.sort_order, c.name, p.name, v.display_name, po.quantity, pr.price_type, pr.minimum_quantity;
$$;

revoke all on function public.get_public_customer_catalog() from public;
grant execute on function public.get_public_customer_catalog() to anon, authenticated;
