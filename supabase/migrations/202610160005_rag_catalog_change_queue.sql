-- Rebuild the verified catalog when its retrieval attributes, package units,
-- source links, or reviewed source text change. Live prices are still read from
-- public.prices for every answer; this queue keeps searchable package/source
-- metadata in sync without embedding price amounts.

grant select on public.packaging_options to rag_index_worker;
drop policy if exists rag_worker_reads_verified_packaging on public.packaging_options;
create policy rag_worker_reads_verified_packaging on public.packaging_options
  for select to rag_index_worker using (exists (
    select 1 from public.product_variants v
    where v.id = packaging_options.variant_id and v.active and v.verification_status = 'verified'
  ));

create or replace function private.enqueue_rag_catalog_index()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.rag_index_jobs as job (job_key, status, requested_revision, attempt_count, available_at)
    values ('verified_catalog', 'queued', 1, 0, pg_catalog.now())
  on conflict (job_key) do update set
    requested_revision = job.requested_revision + 1,
    status = case when job.status = 'running' then 'running' else 'queued' end,
    attempt_count = case when job.status = 'running' then job.attempt_count else 0 end,
    available_at = pg_catalog.now(),
    last_error_code = null,
    last_error_message = null,
    updated_at = pg_catalog.now();
end
$$;
revoke all on function private.enqueue_rag_catalog_index() from public, anon, authenticated, rag_index_worker;

create or replace function private.queue_rag_catalog_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else pg_catalog.to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else pg_catalog.to_jsonb(new) end;
  variant_ids bigint[] := '{}'::bigint[];
  affected_id bigint;
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
        affected_id := coalesce((new_row->>'id')::bigint, (old_row->>'id')::bigint);
        variant_ids := array[affected_id];
      end if;
    when 'prices' then
      for affected_id in select distinct value::bigint from pg_catalog.jsonb_array_elements_text(
        pg_catalog.jsonb_build_array(old_row->>'packaging_id', new_row->>'packaging_id')) as package_ids(value)
        where value is not null
      loop
        select po.variant_id into variant_id from public.packaging_options po where po.id = affected_id;
        if variant_id is not null then variant_ids := pg_catalog.array_append(variant_ids, variant_id); end if;
      end loop;
    when 'packaging_options' then
      variant_ids := pg_catalog.array_remove(array[(old_row->>'variant_id')::bigint, (new_row->>'variant_id')::bigint], null);
    when 'variant_sources' then
      variant_ids := pg_catalog.array_remove(array[(old_row->>'variant_id')::bigint, (new_row->>'variant_id')::bigint], null);
    when 'source_pages' then
      for variant_id in select distinct s.variant_id from public.variant_sources s
        where s.source_page_id = coalesce((new_row->>'id')::bigint, (old_row->>'id')::bigint)
      loop variant_ids := pg_catalog.array_append(variant_ids, variant_id); end loop;
    when 'rag_page_texts' then
      for variant_id in select distinct s.variant_id from public.variant_sources s
        where s.source_page_id = any(pg_catalog.array_remove(array[(old_row->>'source_page_id')::bigint, (new_row->>'source_page_id')::bigint], null))
      loop variant_ids := pg_catalog.array_append(variant_ids, variant_id); end loop;
    when 'product_aliases' then
      for variant_id in select v.id from public.product_variants v
        where v.product_id = any(pg_catalog.array_remove(array[(old_row->>'product_id')::bigint, (new_row->>'product_id')::bigint], null))
      loop variant_ids := pg_catalog.array_append(variant_ids, variant_id); end loop;
    when 'products' then
      for variant_id in select v.id from public.product_variants v
        where v.product_id = any(pg_catalog.array_remove(array[(old_row->>'id')::bigint, (new_row->>'id')::bigint], null))
      loop variant_ids := pg_catalog.array_append(variant_ids, variant_id); end loop;
    when 'categories' then
      for variant_id in select v.id from public.product_variants v join public.products p on p.id = v.product_id
        where p.category_id = any(pg_catalog.array_remove(array[(old_row->>'id')::bigint, (new_row->>'id')::bigint], null))
      loop variant_ids := pg_catalog.array_append(variant_ids, variant_id); end loop;
  end case;

  for variant_id in select distinct id from pg_catalog.unnest(variant_ids) as ids(id) where id is not null
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

drop trigger if exists product_variants_queue_verified_rag_index on public.product_variants;
drop function if exists private.queue_verified_catalog_index();
create trigger product_variants_queue_rag_index
  after insert or update or delete on public.product_variants
  for each row execute function private.queue_rag_catalog_change();
create trigger prices_queue_rag_index
  after insert or update or delete on public.prices
  for each row execute function private.queue_rag_catalog_change();
create trigger packaging_options_queue_rag_index
  after insert or update or delete on public.packaging_options
  for each row execute function private.queue_rag_catalog_change();
create trigger variant_sources_queue_rag_index
  after insert or update or delete on public.variant_sources
  for each row execute function private.queue_rag_catalog_change();
create trigger source_pages_queue_rag_index
  after insert or update or delete on public.source_pages
  for each row execute function private.queue_rag_catalog_change();
create trigger rag_page_texts_queue_rag_index
  after insert or update or delete on public.rag_page_texts
  for each row execute function private.queue_rag_catalog_change();
create trigger product_aliases_queue_rag_index
  after insert or update or delete on public.product_aliases
  for each row execute function private.queue_rag_catalog_change();
create trigger products_queue_rag_index
  after insert or update or delete on public.products
  for each row execute function private.queue_rag_catalog_change();
create trigger categories_queue_rag_index
  after insert or update or delete on public.categories
  for each row execute function private.queue_rag_catalog_change();
