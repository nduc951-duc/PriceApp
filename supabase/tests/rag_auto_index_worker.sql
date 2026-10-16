-- Run against an isolated test database after worker/catalog migrations are applied.
-- Public RAG RPCs deliberately return only currently published, verified catalog data.
-- This transaction rolls back all fixture rows.
begin;

do $$
declare
  before_revision bigint;
  after_first bigint;
  after_repeat bigint;
  after_retry_event bigint;
  category_id bigint;
  product_id bigint;
  v_variant_id bigint;
  v_source_page_id bigint;
  packaging_id bigint;
  supplier_id bigint;
  price_list_id bigint;
  observed_revision bigint;
begin
  if to_regprocedure('public.search_public_rag_catalog(text,integer)') is null
     or to_regprocedure('public.match_public_rag_chunks(extensions.vector,text,integer)') is null
     or to_regprocedure('public.current_public_rag_variant_sources(bigint[])') is null
     or to_regprocedure('public.get_public_rag_catalog(bigint[])') is null then
    raise exception 'public RAG query functions are missing';
  end if;
  if not has_function_privilege('anon', 'public.search_public_rag_catalog(text,integer)', 'execute')
     or not has_function_privilege('anon', 'public.match_public_rag_chunks(extensions.vector,text,integer)', 'execute')
     or not has_function_privilege('anon', 'public.current_public_rag_variant_sources(bigint[])', 'execute')
     or not has_function_privilege('anon', 'public.get_public_rag_catalog(bigint[])', 'execute') then
    raise exception 'anonymous shoppers cannot call the narrow public RAG RPCs';
  end if;
  if has_function_privilege('authenticated', 'public.search_public_rag_catalog(text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.match_public_rag_chunks(extensions.vector,text,integer)', 'execute')
     or has_function_privilege('anon', 'public.search_catalog(text,integer,bigint)', 'execute')
     or has_function_privilege('anon', 'public.match_rag_chunks(extensions.vector,text,integer)', 'execute') then
    raise exception 'public RAG grants widened the staff search surface';
  end if;
  if has_table_privilege('anon', 'public.prices', 'select')
     or has_table_privilege('anon', 'public.rag_chunks', 'select') then
    raise exception 'anonymous shoppers received direct table access for RAG';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.match_public_rag_chunks(extensions.vector,text,integer)'::regprocedure)
     or position('verified_catalog' in pg_get_functiondef('public.match_public_rag_chunks(extensions.vector,text,integer)'::regprocedure)) = 0
     or position('rag_chunk_is_current' in pg_get_functiondef('public.match_public_rag_chunks(extensions.vector,text,integer)'::regprocedure)) = 0 then
    raise exception 'public vector search is not restricted to current verified catalog evidence';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.get_public_rag_catalog(bigint[])'::regprocedure)
     or position('verification_status' in pg_get_functiondef('public.get_public_rag_catalog(bigint[])'::regprocedure)) = 0
     or position('not pl.is_sample' in lower(pg_get_functiondef('public.get_public_rag_catalog(bigint[])'::regprocedure))) = 0 then
    raise exception 'public RAG price lookup does not restrict data to the verified public catalog';
  end if;

  if (select rolbypassrls from pg_roles where rolname = 'rag_index_worker') then
    raise exception 'worker database role bypasses RLS';
  end if;
  if to_regprocedure('private.rag_request_user_id()') is null then
    raise exception 'RAG request identity helper is missing';
  end if;
  if not has_schema_privilege('rag_index_worker', 'private', 'usage')
     or not has_schema_privilege('authenticated', 'private', 'usage')
     or not has_function_privilege('rag_index_worker', 'private.rag_request_user_id()', 'execute')
     or not has_function_privilege('authenticated', 'private.rag_request_user_id()', 'execute') then
    raise exception 'RAG request identity helper is not executable by indexing callers';
  end if;
  if has_function_privilege('anon', 'private.rag_request_user_id()', 'execute')
     or (select prosecdef from pg_proc where oid = 'private.rag_request_user_id()'::regprocedure) then
    raise exception 'RAG request identity helper is public or bypasses invoker security';
  end if;
  if not has_schema_privilege('rag_index_worker', 'extensions', 'usage') then
    raise exception 'worker cannot use the vector type schema for staged embeddings';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'rag_start_index_run', 'rag_advance_index_run', 'rag_publish_index_run', 'rag_abandon_index_run',
      'claim_rag_index_job', 'heartbeat_rag_index_job', 'complete_rag_index_job', 'fail_rag_index_job', 'request_rag_catalog_reindex'
    ) and p.prosecdef) then
    raise exception 'worker-callable index function bypasses RLS';
  end if;
  if has_table_privilege('rag_index_worker', 'public.prices', 'select') then
    raise exception 'worker unexpectedly has price-table access';
  end if;
  if not has_table_privilege('rag_index_worker', 'public.packaging_options', 'select') then
    raise exception 'worker cannot read verified packaging metadata';
  end if;
  if not has_table_privilege('rag_index_worker', 'public.rag_chunks', 'insert') then
    raise exception 'worker cannot stage RAG chunks';
  end if;
  if not has_sequence_privilege('rag_index_worker', 'public.rag_index_runs_id_seq', 'USAGE')
     or not has_sequence_privilege('rag_index_worker', 'public.rag_index_runs_id_seq', 'SELECT') then
    raise exception 'worker cannot allocate index run IDs';
  end if;
  if has_function_privilege('authenticated', 'public.claim_rag_index_job()', 'execute') then
    raise exception 'regular authenticated users can claim worker jobs';
  end if;
  if not has_function_privilege('rag_index_worker', 'public.claim_rag_index_job()', 'execute') then
    raise exception 'worker cannot claim its queue job';
  end if;

  select requested_revision into before_revision
    from public.rag_index_jobs where job_key = 'verified_catalog';
  insert into public.categories (name, slug) values ('RAG worker fixture', 'rag-worker-test-' || txid_current())
    returning id into category_id;
  insert into public.products (category_id, name) values (category_id, 'RAG worker fixture') returning id into product_id;
  insert into public.product_variants (product_id, display_name, verification_status)
    values (product_id, 'RAG worker fixture', 'needs_review') returning id into v_variant_id;

  update public.product_variants set verification_status = 'verified' where id = v_variant_id;
  select requested_revision into after_first from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_first <> before_revision + 1 then raise exception 'verified transition did not enqueue exactly one request'; end if;

  update public.product_variants set verification_status = 'verified' where id = v_variant_id;
  select requested_revision into after_repeat from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_repeat <> after_first then raise exception 'duplicate verified update created duplicate queue work'; end if;

  insert into public.product_variants (product_id, display_name, verification_status)
    values (product_id, 'New verified RAG fixture', 'verified');
  select requested_revision into after_retry_event from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_retry_event <> after_first + 1 then raise exception 'a newly inserted verified variant did not enqueue indexing'; end if;

  update public.product_variants set verification_status = 'needs_review' where id = v_variant_id;
  update public.product_variants set verification_status = 'verified' where id = v_variant_id;
  select requested_revision into after_retry_event from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_retry_event <> after_first + 3 then raise exception 'unverify/reverify transitions did not enqueue refreshes'; end if;

  select requested_revision into observed_revision from public.rag_index_jobs where job_key = 'verified_catalog';
  insert into public.source_pages (page_number, storage_path, verification_status)
    values (77, 'rag-worker-test-' || txid_current() || '.jpg', 'verified') returning id into v_source_page_id;
  insert into public.variant_sources (variant_id, source_page_id) values (v_variant_id, v_source_page_id);
  select requested_revision into after_first from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_first <> observed_revision + 1 then raise exception 'adding a source link did not queue a refresh'; end if;

  insert into public.packaging_options (variant_id, name, quantity, base_unit, note)
    values (v_variant_id, 'RAG test bag', 10, 'piece', null) returning id into packaging_id;
  select requested_revision into after_first from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_first <> observed_revision + 2 then raise exception 'adding package metadata did not queue a refresh'; end if;
  update public.packaging_options set base_unit = 'set' where id = packaging_id;
  select requested_revision into after_first from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_first <> observed_revision + 3 then raise exception 'changing a package unit did not queue a refresh'; end if;

  insert into public.suppliers (name) values ('RAG worker fixture ' || txid_current()) returning id into supplier_id;
  insert into public.price_lists (supplier_id, name, effective_date)
    values (supplier_id, 'RAG worker fixture', current_date) returning id into price_list_id;
  insert into public.prices (packaging_id, price_list_id, price_type, amount)
    values (packaging_id, price_list_id, 'retail', 12345) returning id into after_first;
  select requested_revision into observed_revision from public.rag_index_jobs where job_key = 'verified_catalog';
  update public.prices set amount = 23456 where id = after_first;
  select requested_revision into after_retry_event from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_retry_event <> observed_revision + 1 then raise exception 'changing an active price did not queue a refresh'; end if;

  select requested_revision into observed_revision from public.rag_index_jobs where job_key = 'verified_catalog';
  delete from public.variant_sources s where s.variant_id = v_variant_id and s.source_page_id = v_source_page_id;
  select requested_revision into after_retry_event from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_retry_event <> observed_revision + 1 then raise exception 'removing a source link did not queue a refresh'; end if;
end $$;

rollback;
