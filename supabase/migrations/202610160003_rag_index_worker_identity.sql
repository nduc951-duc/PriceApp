-- A dedicated Data API role keeps the indexing worker inside RLS. It is not
-- a service_role and cannot inherit the normal authenticated role's grants.
do $$ begin
  create role rag_index_worker nologin noinherit;
exception when duplicate_object then null;
end $$;
alter role rag_index_worker nologin noinherit nobypassrls;
grant rag_index_worker to authenticator;
grant usage on schema public, auth to rag_index_worker;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

create table if not exists private.rag_worker_identities (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.rag_worker_identities enable row level security;
revoke all on private.rag_worker_identities from public, anon, authenticated, rag_index_worker;
grant select on private.rag_worker_identities to supabase_auth_admin;
drop policy if exists rag_auth_admin_reads_worker_identity on private.rag_worker_identities;
create policy rag_auth_admin_reads_worker_identity on private.rag_worker_identities
  for select to supabase_auth_admin using (true);

-- Enable this function as the Supabase Custom Access Token Hook in Auth settings.
-- It changes the Postgres role claim only for explicitly registered worker users.
create or replace function public.rag_worker_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  worker_id uuid;
begin
  worker_id := (event ->> 'user_id')::uuid;
  if exists (select 1 from private.rag_worker_identities where user_id = worker_id) then
    claims := pg_catalog.jsonb_set(claims, '{role}', '"rag_index_worker"'::jsonb, true);
  end if;
  return pg_catalog.jsonb_set(event, '{claims}', claims, true);
end
$$;
revoke all on function public.rag_worker_access_token_hook(jsonb) from public, anon, authenticated, rag_index_worker;
grant execute on function public.rag_worker_access_token_hook(jsonb) to supabase_auth_admin;

grant select on public.categories, public.products, public.product_aliases,
  public.product_variants, public.variant_sources, public.source_pages,
  public.rag_page_texts, public.rag_chunks, public.rag_index_state,
  public.rag_index_runs to rag_index_worker;
grant insert, update, delete on public.rag_chunks to rag_index_worker;
grant usage, select on sequence public.rag_chunks_id_seq to rag_index_worker;
grant insert, update on public.rag_index_runs to authenticated, rag_index_worker;
grant update on public.rag_index_state to authenticated, rag_index_worker;

drop policy if exists "owners manage rag index runs" on public.rag_index_runs;
create policy "owners manage rag index runs" on public.rag_index_runs
  for all to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  );
drop policy if exists rag_worker_manages_own_index_runs on public.rag_index_runs;
create policy rag_worker_manages_own_index_runs on public.rag_index_runs
  for all to rag_index_worker using (started_by = auth.uid()) with check (started_by = auth.uid());
drop policy if exists owners_publish_rag_index_state on public.rag_index_state;
create policy owners_publish_rag_index_state on public.rag_index_state
  for update to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
  ) with check (true);
drop policy if exists rag_worker_publishes_complete_index_state on public.rag_index_state;
create policy rag_worker_publishes_complete_index_state on public.rag_index_state
  for update to rag_index_worker using (id = true) with check (
    id = true and exists (select 1 from public.rag_index_runs r
      where r.id = active_generation and r.started_by = auth.uid() and r.status = 'completed'
        and r.checkpoint = r.total_chunks)
  );

drop policy if exists rag_worker_reads_verified_variants on public.product_variants;
create policy rag_worker_reads_verified_variants on public.product_variants
  for select to rag_index_worker using (active and verification_status = 'verified');
drop policy if exists rag_worker_reads_referenced_products on public.products;
create policy rag_worker_reads_referenced_products on public.products
  for select to rag_index_worker using (exists (
    select 1 from public.product_variants v
    where v.product_id = products.id and v.active and v.verification_status = 'verified'
  ));
drop policy if exists rag_worker_reads_referenced_categories on public.categories;
create policy rag_worker_reads_referenced_categories on public.categories
  for select to rag_index_worker using (exists (
    select 1 from public.products p join public.product_variants v on v.product_id = p.id
    where p.category_id = categories.id and v.active and v.verification_status = 'verified'
  ));
drop policy if exists rag_worker_reads_referenced_aliases on public.product_aliases;
create policy rag_worker_reads_referenced_aliases on public.product_aliases
  for select to rag_index_worker using (exists (
    select 1 from public.products p join public.product_variants v on v.product_id = p.id
    where p.id = product_aliases.product_id and v.active and v.verification_status = 'verified'
  ));
drop policy if exists rag_worker_reads_verified_variant_sources on public.variant_sources;
create policy rag_worker_reads_verified_variant_sources on public.variant_sources
  for select to rag_index_worker using (exists (
    select 1 from public.product_variants v
    where v.id = variant_sources.variant_id and v.active and v.verification_status = 'verified'
  ));
drop policy if exists rag_worker_reads_source_pages on public.source_pages;
create policy rag_worker_reads_source_pages on public.source_pages
  for select to rag_index_worker using (
    verification_status <> 'unreadable'
    and (exists (select 1 from public.variant_sources s join public.product_variants v on v.id = s.variant_id
      where s.source_page_id = source_pages.id and v.active and v.verification_status = 'verified')
      or exists (select 1 from public.rag_page_texts t
        where t.source_page_id = source_pages.id and t.review_status in ('approved', 'rejected')))
  );
drop policy if exists rag_worker_reads_reviewed_page_text on public.rag_page_texts;
create policy rag_worker_reads_reviewed_page_text on public.rag_page_texts
  for select to rag_index_worker using (review_status in ('approved', 'rejected'));
drop policy if exists rag_worker_reads_index_state on public.rag_index_state;
create policy rag_worker_reads_index_state on public.rag_index_state
  for select to rag_index_worker using (id = true);
drop policy if exists rag_worker_reads_own_index_runs on public.rag_index_runs;
create policy rag_worker_reads_own_index_runs on public.rag_index_runs
  for select to rag_index_worker using (started_by = auth.uid());
drop policy if exists rag_worker_reads_current_or_own_chunks on public.rag_chunks;
create policy rag_worker_reads_current_or_own_chunks on public.rag_chunks
  for select to rag_index_worker using (
    generation_id = (select s.active_generation from public.rag_index_state s where s.id = true)
    or exists (select 1 from public.rag_index_runs r
      where r.id = rag_chunks.generation_id and r.started_by = auth.uid() and r.status in ('running', 'completed'))
    or (generation_id <> (select s.active_generation from public.rag_index_state s where s.id = true)
      and exists (select 1 from public.rag_index_runs r
        where r.id = (select s.active_generation from public.rag_index_state s where s.id = true)
          and r.started_by = auth.uid() and r.status = 'completed'))
  );
drop policy if exists rag_worker_stages_own_running_chunks on public.rag_chunks;
create policy rag_worker_stages_own_running_chunks on public.rag_chunks
  for insert to rag_index_worker with check (exists (
    select 1 from public.rag_index_runs r
    where r.id = rag_chunks.generation_id and r.started_by = auth.uid() and r.status = 'running'
  ));
drop policy if exists rag_worker_updates_own_running_chunks on public.rag_chunks;
create policy rag_worker_updates_own_running_chunks on public.rag_chunks
  for update to rag_index_worker using (exists (
    select 1 from public.rag_index_runs r
    where r.id = rag_chunks.generation_id and r.started_by = auth.uid() and r.status = 'running'
  )) with check (exists (
    select 1 from public.rag_index_runs r
    where r.id = rag_chunks.generation_id and r.started_by = auth.uid() and r.status = 'running'
  ));
drop policy if exists rag_worker_deletes_old_chunks_after_publish on public.rag_chunks;
create policy rag_worker_deletes_old_chunks_after_publish on public.rag_chunks
  for delete to rag_index_worker using (
    generation_id <> (select s.active_generation from public.rag_index_state s where s.id = true)
    and exists (select 1 from public.rag_index_runs r
      where r.id = (select s.active_generation from public.rag_index_state s where s.id = true)
        and r.started_by = auth.uid() and r.status = 'completed')
  );

-- Keep existing owner indexing behavior for people, while allowing this exact
-- custom JWT role to drive the same guarded generation operations.
create or replace function public.rag_start_index_run(p_corpus_hash text, p_fingerprint text, p_model text, p_total integer)
returns public.rag_index_runs language plpgsql security invoker set search_path = '' as $$
declare result public.rag_index_runs;
begin
  if auth.role() <> 'rag_index_worker' then
    if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
      raise exception 'RAG index worker or owner required';
    end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(9041001);
  select * into result from public.rag_index_runs where status = 'running' for update;
  if found then
    if result.updated_at > pg_catalog.now() - interval '10 minutes' then return result; end if;
    update public.rag_index_runs set status = 'failed', error_message = 'Worker timeout', updated_at = pg_catalog.now() where id = result.id;
  end if;
  select * into result from public.rag_index_runs
    where status = 'failed' and corpus_hash = p_corpus_hash and fingerprint = p_fingerprint
    order by id desc limit 1 for update;
  if found then
    update public.rag_index_runs set status = 'running', error_message = null, updated_at = pg_catalog.now()
      where id = result.id returning * into result;
  else
    insert into public.rag_index_runs (corpus_hash, fingerprint, model, total_chunks, started_by)
      values (p_corpus_hash, p_fingerprint, p_model, p_total, auth.uid()) returning * into result;
  end if;
  return result;
end $$;

create or replace function public.rag_advance_index_run(p_run_id bigint, p_expected integer, p_next integer, p_changed integer, p_reused integer, p_keys text[])
returns public.rag_index_runs language plpgsql security invoker set search_path = '' as $$
declare result public.rag_index_runs;
begin
  if auth.role() <> 'rag_index_worker' then
    if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
      raise exception 'RAG index worker or owner required';
    end if;
  end if;
  select * into result from public.rag_index_runs where id = p_run_id for update;
  if result.status <> 'running' or result.started_by <> auth.uid() or result.checkpoint <> p_expected or p_next <= p_expected or p_next > result.total_chunks then
    raise exception 'Index checkpoint conflict';
  end if;
  if pg_catalog.cardinality(p_keys) <> p_next - p_expected
     or (select count(*) from public.rag_chunks where generation_id = p_run_id and chunk_key = any(p_keys)) <> pg_catalog.cardinality(p_keys)
     or (select count(*) from public.rag_chunks where generation_id = p_run_id) < p_next then
    raise exception 'Incomplete staged batch';
  end if;
  update public.rag_index_runs set checkpoint = p_next, changed = changed + p_changed,
    reused = reused + p_reused, updated_at = pg_catalog.now() where id = p_run_id returning * into result;
  return result;
end $$;

create or replace function public.rag_publish_index_run(p_run_id bigint)
returns public.rag_index_runs language plpgsql security invoker set search_path = '' as $$
declare result public.rag_index_runs; old_generation bigint;
begin
  if auth.role() <> 'rag_index_worker' then
    if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
      raise exception 'RAG index worker or owner required';
    end if;
  end if;
  select * into result from public.rag_index_runs where id = p_run_id for update;
  if result.started_by <> auth.uid() or result.status <> 'running' or result.checkpoint <> result.total_chunks
     or (select count(*) from public.rag_chunks where generation_id = p_run_id) <> result.total_chunks then
    raise exception 'Index generation incomplete';
  end if;
  select active_generation into old_generation from public.rag_index_state where id = true for update;
  update public.rag_index_runs set status = 'completed', completed_at = pg_catalog.now(), updated_at = pg_catalog.now(),
    removed = (select count(*) from public.rag_chunks where generation_id = old_generation and chunk_key not in
      (select chunk_key from public.rag_chunks where generation_id = p_run_id))
    where id = p_run_id returning * into result;
  update public.rag_index_state set active_generation = p_run_id, updated_at = pg_catalog.now() where id = true;
  delete from public.rag_chunks where generation_id <> p_run_id;
  return result;
end $$;

create or replace function public.rag_abandon_index_run(p_run_id bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.role() <> 'rag_index_worker' then
    if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
      raise exception 'RAG index worker or owner required';
    end if;
  end if;
  update public.rag_index_runs set status = 'failed', error_message = 'Corpus changed', updated_at = pg_catalog.now()
    where id = p_run_id and started_by = auth.uid() and status = 'running';
end $$;

revoke all on function public.rag_start_index_run(text,text,text,integer),
  public.rag_advance_index_run(bigint,integer,integer,integer,integer,text[]),
  public.rag_publish_index_run(bigint), public.rag_abandon_index_run(bigint) from public, anon;
grant execute on function public.rag_start_index_run(text,text,text,integer),
  public.rag_advance_index_run(bigint,integer,integer,integer,integer,text[]),
  public.rag_publish_index_run(bigint), public.rag_abandon_index_run(bigint) to authenticated, rag_index_worker;
