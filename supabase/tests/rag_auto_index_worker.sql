-- Run only against an isolated/staging Supabase database after both worker
-- migrations are applied. This transaction rolls back all fixture rows.
begin;

do $$
declare
  before_revision bigint;
  after_first bigint;
  after_repeat bigint;
  after_retry_event bigint;
  category_id bigint;
  product_id bigint;
  variant_id bigint;
begin
  if (select rolbypassrls from pg_roles where rolname = 'rag_index_worker') then
    raise exception 'worker database role bypasses RLS';
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
  if not has_table_privilege('rag_index_worker', 'public.rag_chunks', 'insert') then
    raise exception 'worker cannot stage RAG chunks';
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
    values (product_id, 'RAG worker fixture', 'needs_review') returning id into variant_id;

  update public.product_variants set verification_status = 'verified' where id = variant_id;
  select requested_revision into after_first from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_first <> before_revision + 1 then raise exception 'verified transition did not enqueue exactly one request'; end if;

  update public.product_variants set verification_status = 'verified' where id = variant_id;
  select requested_revision into after_repeat from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_repeat <> after_first then raise exception 'duplicate verified update created duplicate queue work'; end if;

  update public.product_variants set verification_status = 'needs_review' where id = variant_id;
  update public.product_variants set verification_status = 'verified' where id = variant_id;
  select requested_revision into after_retry_event from public.rag_index_jobs where job_key = 'verified_catalog';
  if after_retry_event <> after_first + 1 then raise exception 'new verified transition did not enqueue another revision'; end if;
end $$;

rollback;
