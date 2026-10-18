-- Treat the Supabase product description as catalog evidence for both search and
-- catalog-generated chunks. Prices remain live SQL data and are never embedded.

create or replace function public.search_catalog (
  query text,
  result_limit int default 20,
  filter_category_id bigint default null
) returns table (
  result_type text,
  id bigint,
  display_name text,
  breadcrumbs text,
  attributes jsonb,
  price_summary jsonb,
  relevance numeric,
  match_reason text
) language sql stable security invoker set search_path = public as $$
  with q as (select lower(unaccent(query)) as value), searchable as (
    select v.id, v.display_name, v.search_text, v.attributes, p.id as product_id,
      p.name as product_name, p.description, c.id as category_id, c.name as category_name,
      lower(unaccent(concat_ws(' ', v.search_text, p.description))) as search_content
    from public.product_variants v
    join public.products p on p.id = v.product_id
    join public.categories c on c.id = p.category_id
  )
  select 'variant'::text, searchable.id, searchable.display_name,
    searchable.category_name || ' / ' || searchable.product_name,
    searchable.attributes,
    coalesce(jsonb_build_object('min', min(pr.amount), 'currency', 'VND'), '{}') as price_summary,
    case
      when lower(unaccent(searchable.display_name)) = (select value from q) then 100
      when searchable.search_content like (select value from q) || '%' then 85
      else greatest(
        similarity(searchable.search_content, (select value from q)) * 60,
        ts_rank(to_tsvector('simple', searchable.search_content), plainto_tsquery('simple', (select value from q))) * 60
      )
    end as relevance,
    case when lower(unaccent(searchable.display_name)) = (select value from q) then 'exact' else 'search' end as match_reason
  from searchable
  left join public.packaging_options po on po.variant_id = searchable.id
  left join public.prices pr on pr.packaging_id = po.id and pr.active
  where searchable.id is not null
    and (filter_category_id is null or searchable.category_id = filter_category_id)
    and (
      searchable.search_content % (select value from q)
      or to_tsvector('simple', searchable.search_content) @@ plainto_tsquery('simple', (select value from q))
    )
  group by searchable.id, searchable.display_name, searchable.search_text, searchable.search_content,
    searchable.attributes, searchable.product_id, searchable.product_name, searchable.description,
    searchable.category_id, searchable.category_name
  order by relevance desc
  limit least(result_limit, 100)
$$;

create or replace function public.search_public_rag_catalog(
  p_query text,
  p_result_limit integer default 8
)
returns table (result_type text, id bigint, relevance numeric)
language sql stable security definer
set search_path = public
as $$
  with query_text as (select lower(unaccent(btrim(coalesce(p_query, '')))) as value),
  matches as (
    select v.id,
      greatest(
        similarity(lower(unaccent(concat_ws(' ', v.display_name, v.raw_specification, v.search_text, p.name, p.description, a.alias))), (select value from query_text)) * 60,
        ts_rank(to_tsvector('simple', lower(unaccent(concat_ws(' ', v.display_name, v.raw_specification, v.search_text, p.name, p.description, a.alias)))), plainto_tsquery('simple', (select value from query_text))) * 60
      )::numeric as score
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.active
    join public.categories c on c.id = p.category_id and c.active
    left join public.product_aliases a on a.product_id = p.id
    where btrim(coalesce(p_query, '')) <> ''
      and v.active and v.verification_status = 'verified'
      and (
        lower(unaccent(concat_ws(' ', v.display_name, v.raw_specification, v.search_text, p.name, p.description, a.alias))) % (select value from query_text)
        or to_tsvector('simple', lower(unaccent(concat_ws(' ', v.display_name, v.raw_specification, v.search_text, p.name, p.description, a.alias)))) @@ plainto_tsquery('simple', (select value from query_text))
      )
  )
  select 'variant'::text, matches.id, max(matches.score)
  from matches
  group by matches.id
  order by max(matches.score) desc, matches.id
  limit least(greatest(coalesce(p_result_limit, 8), 1), 8)
$$;

-- PostgreSQL cannot change a table-returning RPC's row type with CREATE OR REPLACE.
drop function public.get_public_rag_catalog(bigint[]);
create function public.get_public_rag_catalog(p_variant_ids bigint[])
returns table (
  variant_id bigint, display_name text, raw_specification text, verification_status text,
  product_name text, product_description text, category_name text, source_pages integer[],
  packaging_id bigint, packaging_name text, package_quantity numeric, unit text, package_note text,
  price_id bigint, price_version integer, price_amount numeric, price_type text, minimum_quantity numeric,
  price_list_name text, supplier_name text, attributes jsonb, product_id bigint, product_aliases text[]
)
language sql stable security definer
set search_path = public
as $$
  with eligible_sources as (
    select distinct v.id as variant_id, page.page_number
    from public.product_variants v
    join public.variant_sources s on s.variant_id = v.id
    join public.source_pages page on page.id = s.source_page_id
    where page.verification_status <> 'unreadable'
  )
  select v.id, v.display_name, v.raw_specification, v.verification_status::text,
    p.name, p.description, c.name,
    array_agg(distinct eligible_sources.page_number order by eligible_sources.page_number) filter (where eligible_sources.page_number is not null),
    po.id, po.name, po.quantity, po.base_unit, coalesce(po.note, ''),
    pr.id, pr.version, pr.amount, pr.price_type::text, pr.minimum_quantity,
    pl.name, supplier.name, v.attributes, p.id,
    coalesce((select array_agg(a.alias order by a.alias) from public.product_aliases a where a.product_id = p.id), '{}'::text[])
  from public.product_variants v
  join public.products p on p.id = v.product_id and p.active
  join public.categories c on c.id = p.category_id and c.active
  left join eligible_sources on eligible_sources.variant_id = v.id
  left join public.packaging_options po on po.variant_id = v.id
  left join public.prices pr on pr.packaging_id = po.id
    and pr.active and pr.price_type in ('retail', 'wholesale')
    and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to > now())
    and exists (
      select 1 from public.price_lists active_list
      join public.suppliers active_supplier on active_supplier.id = active_list.supplier_id and active_supplier.active
      where active_list.id = pr.price_list_id and not active_list.is_sample
    )
  left join public.price_lists pl on pl.id = pr.price_list_id and not pl.is_sample
  left join public.suppliers supplier on supplier.id = pl.supplier_id and supplier.active
  where v.id = any(coalesce(p_variant_ids, '{}'::bigint[]))
    and cardinality(coalesce(p_variant_ids, '{}'::bigint[])) between 1 and 8
    and v.active and v.verification_status = 'verified'
  group by v.id, p.id, p.description, c.name, po.id, pr.id, pl.name, supplier.name
  order by v.id, po.quantity, pr.price_type, pr.minimum_quantity
$$;

revoke all on function public.search_catalog(text, integer, bigint) from public, anon;
grant execute on function public.search_catalog(text, integer, bigint) to authenticated;
revoke all on function public.search_public_rag_catalog(text, integer) from public, authenticated;
grant execute on function public.search_public_rag_catalog(text, integer) to anon;
revoke all on function public.get_public_rag_catalog(bigint[]) from public, authenticated;
grant execute on function public.get_public_rag_catalog(bigint[]) to anon;
