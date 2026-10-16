-- Run after migrations on an isolated database. All fixture writes roll back.
begin;

do $$
declare
  category_id bigint;
  product_id bigint;
  variant_id bigint;
  source_page_id bigint;
  packaging_id bigint;
  supplier_id bigint;
  price_list_id bigint;
  price_id bigint;
  active_generation bigint;
  fixture_key text := 'acl-regression-' || txid_current()::text;
begin
  insert into public.categories (name, slug)
    values ('ACL regression category', fixture_key)
    returning id into category_id;
  insert into public.products (category_id, name)
    values (category_id, 'ACL regression product ' || fixture_key)
    returning id into product_id;
  insert into public.product_aliases (product_id, alias, normalized_alias)
    values (product_id, 'acl regression alias', 'acl regression alias');
  insert into public.product_variants (
    product_id, sku, display_name, raw_specification, search_text, verification_status
  ) values (
    product_id, 'SKU-' || txid_current()::text, 'ACL regression variant',
    'ACL regression specification', 'ACL regression variant ACL regression specification', 'verified'
  ) returning id into variant_id;
  insert into public.source_pages (page_number, storage_path, verification_status)
    values (987, fixture_key || '.jpg', 'verified') returning id into source_page_id;
  insert into public.variant_sources (variant_id, source_page_id)
    values (variant_id, source_page_id);
  insert into public.packaging_options (variant_id, name, quantity, base_unit)
    values (variant_id, 'ACL regression pack', 4, 'piece') returning id into packaging_id;
  insert into public.suppliers (name)
    values ('ACL regression supplier ' || txid_current()) returning id into supplier_id;
  insert into public.price_lists (supplier_id, name, effective_date)
    values (supplier_id, 'ACL regression list', current_date) returning id into price_list_id;
  insert into public.prices (packaging_id, price_list_id, price_type, amount)
    values (packaging_id, price_list_id, 'retail', 12345) returning id into price_id;

  select state.active_generation into active_generation
  from public.rag_index_state state where state.id = true;
  insert into public.rag_chunks (
    chunk_key, source_page_id, source_revision, product_variant_id, chunk_index,
    content, content_hash, embedding, embedding_model, metadata, generation_id
  ) values (
    fixture_key, source_page_id, 1, variant_id, 0,
    'ACL regression evidence content', md5(fixture_key),
    array_fill(0::real, array[1024])::extensions.vector(1024),
    'acl-regression-model', jsonb_build_object('kind', 'verified_catalog', 'page_number', 987),
    active_generation
  );

  perform set_config('test.acl_regression_variant_id', variant_id::text, true);
  perform set_config('test.acl_regression_source_id', source_page_id::text, true);
  perform set_config('test.acl_regression_price_id', price_id::text, true);
end $$;

do $$
declare
  signature text;
  function_oid oid;
  function_source text;
  privilege_name text;
begin
  foreach signature in array array[
    'public.search_public_rag_catalog(text,integer)',
    'public.match_public_rag_chunks(extensions.vector,text,integer)',
    'public.current_public_rag_variant_sources(bigint[])',
    'public.get_public_rag_catalog(bigint[])'
  ] loop
    function_oid := to_regprocedure(signature);
    if function_oid is null then raise exception 'public RAG RPC is missing: %', signature; end if;
    if not has_function_privilege('anon', function_oid, 'execute') then
      raise exception 'anon cannot execute public RAG RPC: %', signature;
    end if;
    if has_function_privilege('authenticated', function_oid, 'execute') then
      raise exception 'authenticated unexpectedly can execute public RAG RPC: %', signature;
    end if;
    if not (select proc.prosecdef from pg_proc proc where proc.oid = function_oid) then
      raise exception 'public RAG RPC must remain SECURITY DEFINER: %', signature;
    end if;
  end loop;

  if not has_function_privilege('anon', 'public.get_public_customer_catalog()', 'execute')
     or not has_function_privilege('authenticated', 'public.get_public_customer_catalog()', 'execute') then
    raise exception 'customer catalog RPC execution grants changed';
  end if;
  if not (select proc.prosecdef from pg_proc proc
          where proc.oid = 'public.get_public_customer_catalog()'::regprocedure) then
    raise exception 'customer catalog RPC must remain SECURITY DEFINER';
  end if;

  foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.prices', privilege_name)
       or has_table_privilege('anon', 'public.rag_chunks', privilege_name) then
      raise exception 'anon still has direct % privilege on prices or rag_chunks', privilege_name;
    end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid = 'public.prices'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.rag_chunks'::regclass) then
    raise exception 'RLS was disabled on a protected table';
  end if;
  if not has_table_privilege('authenticated', 'public.prices', 'SELECT')
     or not has_table_privilege('authenticated', 'public.rag_chunks', 'SELECT') then
    raise exception 'authenticated table grants changed';
  end if;
  if (select rolbypassrls from pg_roles where rolname = 'rag_index_worker')
     or has_table_privilege('rag_index_worker', 'public.prices', 'SELECT')
     or not has_table_privilege('rag_index_worker', 'public.rag_chunks', 'INSERT') then
    raise exception 'worker privileges or RLS boundary changed';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'rag_chunks'
      and policyname = 'rag_worker_stages_own_running_chunks'
  ) then
    raise exception 'worker RLS staging policy is missing';
  end if;

  function_source := lower(pg_get_functiondef('public.search_public_rag_catalog(text,integer)'::regprocedure));
  if position('verification_status' in function_source) = 0 or position('verified' in function_source) = 0 then
    raise exception 'public catalog RAG RPC no longer filters to verified variants';
  end if;
  function_source := lower(pg_get_functiondef('public.match_public_rag_chunks(extensions.vector,text,integer)'::regprocedure));
  if position('verified_catalog' in function_source) = 0 or position('rag_chunk_is_current' in function_source) = 0 then
    raise exception 'public vector RAG RPC no longer filters to current verified evidence';
  end if;
  function_source := lower(pg_get_functiondef('public.get_public_rag_catalog(bigint[])'::regprocedure));
  if position('verification_status' in function_source) = 0 or position('not pl.is_sample' in function_source) = 0 then
    raise exception 'public price RPC no longer restricts rows to the public catalog';
  end if;
end $$;

set local role anon;
do $$
declare
  expected_variant_id bigint := current_setting('test.acl_regression_variant_id')::bigint;
  expected_source_id bigint := current_setting('test.acl_regression_source_id')::bigint;
  expected_price_id bigint := current_setting('test.acl_regression_price_id')::bigint;
begin
  if not exists (
    select 1 from public.search_public_rag_catalog('ACL regression variant', 8)
    where id = expected_variant_id and result_type = 'variant'
  ) then raise exception 'anon could not retrieve the verified catalog match'; end if;
  if not exists (
    select 1 from public.current_public_rag_variant_sources(array[expected_variant_id])
    where product_variant_id = expected_variant_id and source_page_id = expected_source_id and page_number = 987
  ) then raise exception 'anon could not retrieve the verified source page'; end if;
  if not exists (
    select 1 from public.get_public_rag_catalog(array[expected_variant_id]) catalog
    where catalog.variant_id = expected_variant_id and catalog.price_id = expected_price_id and catalog.price_amount = 12345
  ) then raise exception 'anon could not retrieve the current verified price'; end if;
  if not exists (
    select 1 from public.get_public_customer_catalog()
    where product_code like 'SKU-%'
      and 'acl regression alias' = any(aliases)
      and amount = 12345
  ) then raise exception 'anon customer catalog omitted SKU, aliases, or the current price'; end if;

  if not exists (
    select 1 from public.match_public_rag_chunks(
      array_fill(0::real, array[1024])::extensions.vector(1024), 'acl-regression-model', 8
    ) chunks where chunks.content = 'ACL regression evidence content'
  ) then raise exception 'anon could not retrieve the current verified RAG evidence'; end if;

  begin
    execute 'select 1 from public.prices limit 1';
    raise exception 'anon directly selected public.prices';
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'select 1 from public.rag_chunks limit 1';
    raise exception 'anon directly selected public.rag_chunks';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
do $$
begin
  begin perform 1 from public.search_public_rag_catalog('ACL regression variant', 8);
    raise exception 'authenticated executed search_public_rag_catalog';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.match_public_rag_chunks(null, 'acl-regression-model', 8);
    raise exception 'authenticated executed match_public_rag_chunks';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.current_public_rag_variant_sources(array[1::bigint]);
    raise exception 'authenticated executed current_public_rag_variant_sources';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.get_public_rag_catalog(array[1::bigint]);
    raise exception 'authenticated executed get_public_rag_catalog';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
