-- Allow guest shoppers to ask price questions without opening the staff RAG
-- tables or weakening the worker/authenticated RLS policies. These narrowly
-- scoped SECURITY DEFINER RPCs return only currently public, verified catalog
-- facts and catalog chunks; approved OCR text and staged generations stay private.

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
        similarity(lower(unaccent(concat_ws(' ', v.display_name, v.raw_specification, v.search_text, p.name, a.alias))), (select value from query_text)) * 60,
        ts_rank(to_tsvector('simple', lower(unaccent(concat_ws(' ', v.display_name, v.raw_specification, v.search_text, p.name, a.alias)))), plainto_tsquery('simple', (select value from query_text))) * 60
      )::numeric as score
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.active
    join public.categories c on c.id = p.category_id and c.active
    left join public.product_aliases a on a.product_id = p.id
    where btrim(coalesce(p_query, '')) <> ''
      and v.active and v.verification_status = 'verified'
      and (
        lower(unaccent(concat_ws(' ', v.display_name, v.raw_specification, v.search_text, p.name, a.alias))) % (select value from query_text)
        or to_tsvector('simple', lower(unaccent(concat_ws(' ', v.display_name, v.raw_specification, v.search_text, p.name, a.alias)))) @@ plainto_tsquery('simple', (select value from query_text))
      )
  )
  select 'variant'::text, matches.id, max(matches.score)
  from matches
  group by matches.id
  order by max(matches.score) desc, matches.id
  limit least(greatest(coalesce(p_result_limit, 8), 1), 8)
$$;

create or replace function public.match_public_rag_chunks(
  p_embedding extensions.vector(1024),
  p_embedding_model text,
  p_match_count integer default 8
)
returns table (
  id bigint, chunk_key text, source_page_id bigint, source_revision bigint,
  source_start integer, source_end integer, product_variant_id bigint,
  content text, metadata jsonb, similarity real
)
language sql stable security definer
set search_path = public, extensions
as $$
  select c.id, c.chunk_key, c.source_page_id, c.source_revision,
         c.source_start, c.source_end, c.product_variant_id, c.content,
         jsonb_build_object('kind', 'verified_catalog', 'page_number', c.metadata->'page_number'),
         (1 - (c.embedding <=> p_embedding))::real
  from public.rag_chunks c
  join public.rag_index_state state on state.id = true and state.active_generation = c.generation_id
  join public.product_variants v on v.id = c.product_variant_id and v.active and v.verification_status = 'verified'
  join public.products p on p.id = v.product_id and p.active
  join public.categories cat on cat.id = p.category_id and cat.active
  where c.embedding_model = p_embedding_model
    and vector_dims(c.embedding) = vector_dims(p_embedding)
    and c.metadata->>'kind' = 'verified_catalog'
    and public.rag_chunk_is_current(c.source_page_id, c.product_variant_id, c.source_revision, 'verified_catalog')
  order by c.embedding <=> p_embedding
  limit least(greatest(coalesce(p_match_count, 8), 1), 8)
$$;

create or replace function public.current_public_rag_variant_sources(p_variant_ids bigint[])
returns table (product_variant_id bigint, source_page_id bigint, page_number integer)
language sql stable security definer
set search_path = public
as $$
  select v.id, s.source_page_id, page.page_number
  from public.product_variants v
  join public.variant_sources s on s.variant_id = v.id
  join public.source_pages page on page.id = s.source_page_id
  left join public.rag_page_texts t on t.source_page_id = page.id
  join public.products p on p.id = v.product_id and p.active
  join public.categories c on c.id = p.category_id and c.active
  where v.id = any(coalesce(p_variant_ids, '{}'::bigint[]))
    and cardinality(coalesce(p_variant_ids, '{}'::bigint[])) between 1 and 8
    and v.active and v.verification_status = 'verified'
    and page.verification_status <> 'unreadable'
    and coalesce(t.review_status, 'draft') <> 'rejected'
  order by v.id, page.page_number
$$;

create or replace function public.get_public_rag_catalog(p_variant_ids bigint[])
returns table (
  variant_id bigint, display_name text, raw_specification text, verification_status text,
  product_name text, category_name text, source_pages integer[],
  packaging_id bigint, packaging_name text, package_quantity numeric, unit text, package_note text,
  price_id bigint, price_version integer, price_amount numeric, price_type text, minimum_quantity numeric,
  price_list_name text, supplier_name text
)
language sql stable security definer
set search_path = public
as $$
  with eligible_sources as (
    select distinct v.id as variant_id, page.page_number
    from public.product_variants v
    join public.variant_sources s on s.variant_id = v.id
    join public.source_pages page on page.id = s.source_page_id
    left join public.rag_page_texts t on t.source_page_id = page.id
    where page.verification_status <> 'unreadable'
      and coalesce(t.review_status, 'draft') <> 'rejected'
  )
  select v.id, v.display_name, v.raw_specification, v.verification_status::text,
    p.name, c.name,
    array_agg(distinct eligible_sources.page_number order by eligible_sources.page_number) filter (where eligible_sources.page_number is not null),
    po.id, po.name, po.quantity, po.base_unit, coalesce(po.note, ''),
    pr.id, pr.version, pr.amount, pr.price_type::text, pr.minimum_quantity,
    pl.name, supplier.name
  from public.product_variants v
  join public.products p on p.id = v.product_id and p.active
  join public.categories c on c.id = p.category_id and c.active
  join eligible_sources on eligible_sources.variant_id = v.id
  join public.packaging_options po on po.variant_id = v.id
  join public.prices pr on pr.packaging_id = po.id
  join public.price_lists pl on pl.id = pr.price_list_id and not pl.is_sample
  join public.suppliers supplier on supplier.id = pl.supplier_id and supplier.active
  where v.id = any(coalesce(p_variant_ids, '{}'::bigint[]))
    and cardinality(coalesce(p_variant_ids, '{}'::bigint[])) between 1 and 8
    and v.active and v.verification_status = 'verified'
    and pr.active and pr.price_type in ('retail', 'wholesale')
    and pr.valid_from <= now() and (pr.valid_to is null or pr.valid_to >= now())
  group by v.id, p.name, c.name, po.id, pr.id, pl.name, supplier.name
  order by v.id, po.quantity, pr.price_type, pr.minimum_quantity
$$;

revoke all on function public.search_public_rag_catalog(text, integer) from public, authenticated;
revoke all on function public.match_public_rag_chunks(extensions.vector, text, integer) from public, authenticated;
revoke all on function public.current_public_rag_variant_sources(bigint[]) from public, authenticated;
revoke all on function public.get_public_rag_catalog(bigint[]) from public, authenticated;
grant execute on function public.search_public_rag_catalog(text, integer) to anon;
grant execute on function public.match_public_rag_chunks(extensions.vector, text, integer) to anon;
grant execute on function public.current_public_rag_variant_sources(bigint[]) to anon;
grant execute on function public.get_public_rag_catalog(bigint[]) to anon;
