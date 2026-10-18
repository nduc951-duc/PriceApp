-- Run after migrations on an isolated local/test database. Fixture rows roll back.
begin;

do $$
declare
  category_id bigint;
  product_id bigint;
  first_variant_id bigint;
  second_variant_id bigint;
  third_variant_id bigint;
  review_variant_id bigint;
  inactive_variant_id bigint;
  source_page_id bigint;
  packaging_id bigint;
  supplier_id bigint;
  price_list_id bigint;
  fixture_key text := 'rag-page-' || txid_current()::text;
begin
  insert into public.categories (name, slug)
    values ('RAG page fixture category', fixture_key)
    returning id into category_id;
  insert into public.products (category_id, name)
    values (category_id, 'RAG page fixture product ' || fixture_key)
    returning id into product_id;
  insert into public.product_aliases (product_id, alias, normalized_alias)
    values (product_id, 'RÁG fíxture fástener', 'rag fixture fastener');

  insert into public.product_variants (product_id, display_name, raw_specification, search_text, verification_status)
    values (product_id, 'Fixture size one', '6x50', 'RAG page fixture product fixture size one 6x50', 'verified')
    returning id into first_variant_id;
  insert into public.product_variants (product_id, display_name, raw_specification, search_text, verification_status)
    values (product_id, 'Fixture size two', '8x60', 'RAG page fixture product fixture size two 8x60', 'verified')
    returning id into second_variant_id;
  insert into public.product_variants (product_id, display_name, raw_specification, search_text, verification_status)
    values (product_id, 'Fixture size three', '10x80', 'RAG page fixture product fixture size three 10x80', 'verified')
    returning id into third_variant_id;
  insert into public.product_variants (product_id, display_name, raw_specification, search_text, verification_status)
    values (product_id, 'Fixture under review', '12x100', 'RAG page fixture product fixture under review', 'needs_review')
    returning id into review_variant_id;
  insert into public.product_variants (product_id, display_name, raw_specification, search_text, verification_status, active)
    values (product_id, 'Fixture inactive', '14x120', 'RAG page fixture product fixture inactive', 'verified', false)
    returning id into inactive_variant_id;
  insert into public.source_pages (page_number, storage_path, verification_status)
    values (987, fixture_key || '.jpg', 'verified') returning id into source_page_id;
  insert into public.variant_sources (variant_id, source_page_id)
    values (first_variant_id, source_page_id);

  insert into public.packaging_options (variant_id, name, quantity, base_unit)
    values (first_variant_id, 'Fixture package', 1, 'piece') returning id into packaging_id;
  insert into public.suppliers (name)
    values ('RAG page fixture supplier ' || txid_current()) returning id into supplier_id;
  insert into public.price_lists (supplier_id, name, effective_date)
    values (supplier_id, 'RAG page fixture list', current_date) returning id into price_list_id;
  insert into public.prices (packaging_id, price_list_id, price_type, amount)
    values (packaging_id, price_list_id, 'dealer', 98765);

  perform set_config('test.rag_page_category_id', category_id::text, true);
  perform set_config('test.rag_page_product_id', product_id::text, true);
  perform set_config('test.rag_page_first_variant_id', first_variant_id::text, true);
  perform set_config('test.rag_page_second_variant_id', second_variant_id::text, true);
  perform set_config('test.rag_page_third_variant_id', third_variant_id::text, true);
  perform set_config('test.rag_page_review_variant_id', review_variant_id::text, true);
  perform set_config('test.rag_page_inactive_variant_id', inactive_variant_id::text, true);
end $$;

do $$
declare
  public_oid oid := to_regprocedure('public.list_public_rag_catalog_page(text,text,bigint,integer)');
  staff_oid oid := to_regprocedure('public.list_staff_rag_catalog_page(text,text,bigint,integer)');
begin
  if public_oid is null or staff_oid is null then raise exception 'catalog page RPC is missing'; end if;
  if not has_function_privilege('anon', public_oid, 'execute')
     or has_function_privilege('authenticated', public_oid, 'execute') then
    raise exception 'public catalog page RPC grants are not restricted to anon';
  end if;
  if has_function_privilege('anon', staff_oid, 'execute')
     or not has_function_privilege('authenticated', staff_oid, 'execute') then
    raise exception 'staff catalog page RPC grants are not restricted to authenticated';
  end if;
  if not (select prosecdef from pg_proc where oid = public_oid)
     or (select prosecdef from pg_proc where oid = staff_oid) then
    raise exception 'catalog page RPC security mode changed';
  end if;
end $$;

set local role anon;
do $$
declare
  page_one jsonb;
  page_two jsonb;
  no_matches jsonb;
  category_match jsonb;
  next_id bigint;
  listed_ids bigint[];
begin
  page_one := public.list_public_rag_catalog_page('rag page fixture product', null, null, 2);
  if (page_one->>'total_count')::integer <> 3
     or jsonb_array_length(page_one->'items') <> 2
     or page_one->>'next_cursor' is null then
    raise exception 'first public page did not report the complete total and continuation cursor: %', page_one;
  end if;
  if exists (
    select 1 from jsonb_array_elements(page_one->'items') item
    where item->>'verification_status' <> 'verified'
  ) then raise exception 'public list included an unverified variant'; end if;
  if not exists (
    select 1 from jsonb_array_elements(page_one->'items') item
    where (item->>'id')::bigint = current_setting('test.rag_page_first_variant_id')::bigint
      and item->'source_pages' = '[987]'::jsonb
  ) then raise exception 'public list omitted the current verified source page'; end if;
  if exists (
    select 1 from jsonb_array_elements(page_one->'items') item
    cross join lateral jsonb_array_elements(item->'packaging_options') package
    cross join lateral jsonb_array_elements(package->'prices') price
    where price->>'price_type' = 'dealer'
  ) then raise exception 'public list exposed dealer pricing'; end if;
  next_id := (page_one->>'next_cursor')::bigint;

  page_two := public.list_public_rag_catalog_page('RAG PAGE FIXTURE PRODUCT', null, next_id, 2);
  if (page_two->>'total_count')::integer <> 3
     or jsonb_array_length(page_two->'items') <> 1
     or page_two->>'next_cursor' is not null then
    raise exception 'second public page had duplicate, missing, or incorrect metadata: %', page_two;
  end if;
  select array_agg((item->>'id')::bigint order by (item->>'id')::bigint)
    into listed_ids
  from (
    select jsonb_array_elements(page_one->'items') item
    union all
    select jsonb_array_elements(page_two->'items') item
  ) pages;
  if cardinality(listed_ids) <> 3 or cardinality(array(select distinct unnest(listed_ids))) <> 3 then
    raise exception 'pages do not contain each of the three eligible variants exactly once: %', listed_ids;
  end if;
  if (select count(*) from unnest(listed_ids) id
      where id in (
        current_setting('test.rag_page_review_variant_id')::bigint,
        current_setting('test.rag_page_inactive_variant_id')::bigint
      )) <> 0 then raise exception 'public listing included an ineligible variant'; end if;

  no_matches := public.list_public_rag_catalog_page('no matching catalog item', null, null, 20);
  if (no_matches->>'total_count')::integer <> 0
     or jsonb_array_length(no_matches->'items') <> 0
     or no_matches->>'next_cursor' is not null then
    raise exception 'empty public result returned incorrect pagination metadata';
  end if;
  if (public.list_public_rag_catalog_page('rag fixture fastener', null, null, 50)->>'total_count')::integer <> 3 then
    raise exception 'public alias search did not normalize/search existing product aliases';
  end if;
  category_match := public.list_public_rag_catalog_page('rag page fixture product', 'fixture category', null, 20);
  if (category_match->>'total_count')::integer <> 3 then
    raise exception 'public catalog page did not apply its normalized category phrase';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare
  staff_page jsonb;
begin
  staff_page := public.list_staff_rag_catalog_page('rag page fixture product', null, null, 20);
  if (staff_page->>'total_count')::integer <> 3 then
    raise exception 'authenticated invoker RPC did not return all verified variants through RLS';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(staff_page->'items') item
    cross join lateral jsonb_array_elements(item->'packaging_options') package
    cross join lateral jsonb_array_elements(package->'prices') price
    where price->>'price_type' = 'dealer' and (price->>'amount')::numeric = 98765
  ) then raise exception 'staff RLS path lost its eligible dealer price'; end if;
end $$;
reset role;

rollback;
