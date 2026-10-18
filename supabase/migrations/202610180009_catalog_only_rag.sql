-- Catalog rows are authoritative; OCR is retired from application access.
-- Source images remain optional historical provenance and never gate catalog facts.
alter table public.rag_chunks alter column source_page_id drop not null;
revoke all on public.rag_page_texts from public, anon, authenticated, rag_index_worker;
drop trigger if exists rag_page_texts_queue_rag_index on public.rag_page_texts;
drop trigger if exists prices_queue_rag_index on public.prices;
drop trigger if exists variant_sources_queue_rag_index on public.variant_sources;
drop trigger if exists source_pages_queue_rag_index on public.source_pages;

-- Only edits that change indexed catalog text should enqueue an embedding rebuild.
-- Prices are read live from SQL; source links and scanned pages are display provenance.
create or replace function private.queue_rag_catalog_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else pg_catalog.to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else pg_catalog.to_jsonb(new) end;
  variant_ids bigint[] := '{}'::bigint[];
  affected_ids bigint[] := '{}'::bigint[];
  variant_id bigint;
begin
  if tg_op = 'UPDATE'
     and old_row - array['created_at', 'updated_at']::text[]
       = new_row - array['created_at', 'updated_at']::text[] then
    return new;
  end if;

  case tg_table_name
    when 'product_variants' then
      if old_row->>'verification_status' = 'verified' or new_row->>'verification_status' = 'verified' then
        variant_ids := array[coalesce((new_row->>'id')::bigint, (old_row->>'id')::bigint)];
      end if;
    when 'packaging_options' then
      variant_ids := pg_catalog.array_remove(array[(old_row->>'variant_id')::bigint, (new_row->>'variant_id')::bigint], null);
    when 'product_aliases' then
      affected_ids := pg_catalog.array_remove(array[(old_row->>'product_id')::bigint, (new_row->>'product_id')::bigint], null);
    when 'products' then
      affected_ids := pg_catalog.array_remove(array[(old_row->>'id')::bigint, (new_row->>'id')::bigint], null);
    when 'categories' then
      select coalesce(pg_catalog.array_agg(v.id), '{}'::bigint[]) into variant_ids
      from public.product_variants v join public.products p on p.id = v.product_id
      where p.category_id = any(pg_catalog.array_remove(array[(old_row->>'id')::bigint, (new_row->>'id')::bigint], null));
  end case;

  if cardinality(affected_ids) > 0 then
    select coalesce(pg_catalog.array_agg(v.id), '{}'::bigint[]) into variant_ids
    from public.product_variants v where v.product_id = any(affected_ids);
  end if;

  for variant_id in
    select distinct id from pg_catalog.unnest(variant_ids) as ids(id) where id is not null
  loop
    if tg_table_name = 'product_variants'
       or exists (select 1 from public.product_variants v where v.id = variant_id and v.active and v.verification_status = 'verified') then
      perform private.enqueue_rag_catalog_index();
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function private.queue_rag_catalog_change() from public, anon, authenticated, rag_index_worker;

create or replace function public.rag_chunk_is_current(
  p_source_page_id bigint, p_product_variant_id bigint, p_source_revision bigint, p_kind text
) returns boolean language sql stable security invoker set search_path = public as $$
  select p_kind = 'verified_catalog' and exists (
    select 1 from public.product_variants v
    join public.products p on p.id = v.product_id and p.active
    join public.categories c on c.id = p.category_id and c.active
    where v.id = p_product_variant_id and v.active and v.verification_status = 'verified'
  );
$$;
revoke all on function public.rag_chunk_is_current(bigint,bigint,bigint,text) from public, anon;
grant execute on function public.rag_chunk_is_current(bigint,bigint,bigint,text) to authenticated, rag_index_worker;

create or replace function public.current_public_rag_variant_sources(p_variant_ids bigint[])
returns table (product_variant_id bigint, source_page_id bigint, page_number integer)
language sql stable security definer
set search_path = public
as $$
  select v.id, s.source_page_id, page.page_number
  from public.product_variants v
  join public.variant_sources s on s.variant_id = v.id
  join public.source_pages page on page.id = s.source_page_id

  join public.products p on p.id = v.product_id and p.active
  join public.categories c on c.id = p.category_id and c.active
  where v.id = any(coalesce(p_variant_ids, '{}'::bigint[]))
    and cardinality(coalesce(p_variant_ids, '{}'::bigint[])) between 1 and 8
    and v.active and v.verification_status = 'verified'
    and page.verification_status <> 'unreadable'

  order by v.id, page.page_number
$$;


create or replace function public.current_rag_variant_sources(p_variant_ids bigint[])
returns table (product_variant_id bigint, source_page_id bigint, page_number integer)
language sql stable security invoker set search_path = public as $$
 select v.id, s.source_page_id, page.page_number
 from public.product_variants v
 join public.products p on p.id = v.product_id and p.active
 join public.categories c on c.id = p.category_id and c.active
 join public.variant_sources s on s.variant_id = v.id
 join public.source_pages page on page.id = s.source_page_id
 where v.id = any(coalesce(p_variant_ids, '{}'::bigint[]))
   and v.active and v.verification_status = 'verified' and page.verification_status <> 'unreadable';
$$;

drop function public.get_public_rag_catalog(bigint[]);
create function public.get_public_rag_catalog(p_variant_ids bigint[])
returns table (
  variant_id bigint, display_name text, raw_specification text, verification_status text,
  product_name text, category_name text, source_pages integer[],
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
    p.name, c.name,
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
    and exists (select 1 from public.price_lists pl join public.suppliers s on s.id = pl.supplier_id and s.active where pl.id = pr.price_list_id and not pl.is_sample)
  left join public.price_lists pl on pl.id = pr.price_list_id and not pl.is_sample
  left join public.suppliers supplier on supplier.id = pl.supplier_id and supplier.active
  where v.id = any(coalesce(p_variant_ids, '{}'::bigint[]))
    and cardinality(coalesce(p_variant_ids, '{}'::bigint[])) between 1 and 8
    and v.active and v.verification_status = 'verified'
  group by v.id, p.id, c.name, po.id, pr.id, pl.name, supplier.name
  order by v.id, po.quantity, pr.price_type, pr.minimum_quantity
$$;


revoke all on function public.get_public_rag_catalog(bigint[]) from public, authenticated;
grant execute on function public.get_public_rag_catalog(bigint[]) to anon;

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

    where page.verification_status <> 'unreadable'

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
        'attributes', v.attributes,
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
        'attributes', v.attributes,
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

-- Refresh the catalog generation with variant keys, not page/OCR keys.
select private.enqueue_rag_catalog_index();
