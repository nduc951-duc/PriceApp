-- Complete, keyset-paged catalog search for assistant list requests.
-- Guest reads remain scoped to public verified rows. Staff reads run as the
-- authenticated caller so the existing table grants and RLS remain in force.

create or replace function public.list_public_rag_catalog_page(
  p_query text,
  p_category_text text default null,
  p_after_variant_id bigint default null,
  p_page_size integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with query_config as (
    select lower(unaccent(btrim(coalesce(p_query, '')))) as normalized_query,
      least(greatest(coalesce(p_page_size, 20), 1), 50) as page_size
  ), matching as materialized (
    select distinct v.id
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.active
    join public.categories c on c.id = p.category_id and c.active
    cross join query_config q
    where v.active and v.verification_status = 'verified'
      and (nullif(btrim(p_category_text), '') is null or position(
        lower(unaccent(btrim(p_category_text))) in lower(unaccent(c.name))
      ) > 0)
      and (
        q.normalized_query = ''
        or position(q.normalized_query in lower(unaccent(concat_ws(' ', c.name, p.name, p.default_brand,
          v.sku, v.display_name, v.raw_specification, v.search_text)))) > 0
        or exists (
          select 1 from public.product_aliases alias
          where alias.product_id = p.id
            and position(q.normalized_query in lower(unaccent(alias.alias))) > 0
        )
      )
  ), page_window as (
    select matched.id from matching matched
    where p_after_variant_id is null or matched.id > p_after_variant_id
    order by matched.id
    limit (select page_size + 1 from query_config)
  ), page as (
    select page_candidate.id from page_window page_candidate
    order by page_candidate.id
    limit (select page_size from query_config)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', p.id,
        'id', v.id,
        'sku', v.sku,
        'display_name', v.display_name,
        'raw_specification', v.raw_specification,
        'verification_status', v.verification_status::text,
        'products', jsonb_build_object(
          'name', p.name,
          'categories', jsonb_build_object('name', c.name),
          'product_aliases', coalesce((
            select jsonb_agg(jsonb_build_object('alias', alias.alias) order by alias.alias)
            from public.product_aliases alias where alias.product_id = p.id
          ), '[]'::jsonb)
        ),
        'packaging_options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', po.id,
            'name', po.name,
            'quantity', po.quantity,
            'base_unit', po.base_unit,
            'note', po.note,
            'prices', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', pr.id,
                'version', pr.version,
                'amount', pr.amount,
                'price_type', pr.price_type,
                'minimum_quantity', pr.minimum_quantity,
                'active', pr.active,
                'valid_from', pr.valid_from,
                'valid_to', pr.valid_to,
                'price_lists', jsonb_build_object(
                  'name', pl.name,
                  'effective_date', pl.effective_date,
                  'suppliers', jsonb_build_object('name', supplier.name)
                )
              ) order by pr.price_type, pr.minimum_quantity, pr.id)
              from public.prices pr
              join public.price_lists pl on pl.id = pr.price_list_id and not pl.is_sample
              join public.suppliers supplier on supplier.id = pl.supplier_id and supplier.active
              where pr.packaging_id = po.id
                and pr.active and pr.price_type in ('retail', 'wholesale')
                and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
            ), '[]'::jsonb)
          ) order by po.quantity, po.id)
          from public.packaging_options po where po.variant_id = v.id
        ), '[]'::jsonb),
        'source_pages', coalesce((
          select jsonb_agg(distinct source_page.page_number order by source_page.page_number)
          from public.current_public_rag_variant_sources(array[v.id]) source_page
          where source_page.page_number is not null
        ), '[]'::jsonb)
      ) order by v.id)
      from page selected
      join public.product_variants v on v.id = selected.id
      join public.products p on p.id = v.product_id
      join public.categories c on c.id = p.category_id
    ), '[]'::jsonb),
    'total_count', (select count(*) from matching),
    'next_cursor', (
      select case when count(*) > (select page_size from query_config)
        then (select max(page.id) from page) else null end
      from page_window
    )
  )
$$;

create or replace function public.list_staff_rag_catalog_page(
  p_query text,
  p_category_text text default null,
  p_after_variant_id bigint default null,
  p_page_size integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with query_config as (
    select lower(unaccent(btrim(coalesce(p_query, '')))) as normalized_query,
      least(greatest(coalesce(p_page_size, 20), 1), 50) as page_size
  ), matching as materialized (
    select distinct v.id
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.active
    join public.categories c on c.id = p.category_id and c.active
    cross join query_config q
    where v.active and v.verification_status = 'verified'
      and (nullif(btrim(p_category_text), '') is null or position(
        lower(unaccent(btrim(p_category_text))) in lower(unaccent(c.name))
      ) > 0)
      and (
        q.normalized_query = ''
        or position(q.normalized_query in lower(unaccent(concat_ws(' ', c.name, p.name, p.default_brand,
          v.sku, v.display_name, v.raw_specification, v.search_text)))) > 0
        or exists (
          select 1 from public.product_aliases alias
          where alias.product_id = p.id
            and position(q.normalized_query in lower(unaccent(alias.alias))) > 0
        )
      )
  ), page_window as (
    select matched.id from matching matched
    where p_after_variant_id is null or matched.id > p_after_variant_id
    order by matched.id
    limit (select page_size + 1 from query_config)
  ), page as (
    select page_candidate.id from page_window page_candidate
    order by page_candidate.id
    limit (select page_size from query_config)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', p.id,
        'id', v.id,
        'sku', v.sku,
        'display_name', v.display_name,
        'raw_specification', v.raw_specification,
        'verification_status', v.verification_status::text,
        'products', jsonb_build_object(
          'name', p.name,
          'categories', jsonb_build_object('name', c.name),
          'product_aliases', coalesce((
            select jsonb_agg(jsonb_build_object('alias', alias.alias) order by alias.alias)
            from public.product_aliases alias where alias.product_id = p.id
          ), '[]'::jsonb)
        ),
        'packaging_options', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', po.id,
            'name', po.name,
            'quantity', po.quantity,
            'base_unit', po.base_unit,
            'note', po.note,
            'prices', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', pr.id,
                'version', pr.version,
                'amount', pr.amount,
                'price_type', pr.price_type,
                'minimum_quantity', pr.minimum_quantity,
                'active', pr.active,
                'valid_from', pr.valid_from,
                'valid_to', pr.valid_to,
                'price_lists', jsonb_build_object(
                  'name', pl.name,
                  'effective_date', pl.effective_date,
                  'suppliers', jsonb_build_object('name', supplier.name)
                )
              ) order by pr.price_type, pr.minimum_quantity, pr.id)
              from public.prices pr
              join public.price_lists pl on pl.id = pr.price_list_id and not pl.is_sample
              join public.suppliers supplier on supplier.id = pl.supplier_id and supplier.active
              where pr.packaging_id = po.id
                and pr.active and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
            ), '[]'::jsonb)
          ) order by po.quantity, po.id)
          from public.packaging_options po where po.variant_id = v.id
        ), '[]'::jsonb),
        'source_pages', coalesce((
          select jsonb_agg(distinct source_page.page_number order by source_page.page_number)
          from public.current_rag_variant_sources(array[v.id]) source_page
          where source_page.page_number is not null
        ), '[]'::jsonb)
      ) order by v.id)
      from page selected
      join public.product_variants v on v.id = selected.id
      join public.products p on p.id = v.product_id
      join public.categories c on c.id = p.category_id
    ), '[]'::jsonb),
    'total_count', (select count(*) from matching),
    'next_cursor', (
      select case when count(*) > (select page_size from query_config)
        then (select max(page.id) from page) else null end
      from page_window
    )
  )
$$;

revoke all on function public.list_public_rag_catalog_page(text, text, bigint, integer)
  from public, authenticated;
grant execute on function public.list_public_rag_catalog_page(text, text, bigint, integer) to anon;

revoke all on function public.list_staff_rag_catalog_page(text, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.list_staff_rag_catalog_page(text, text, bigint, integer) to authenticated;
