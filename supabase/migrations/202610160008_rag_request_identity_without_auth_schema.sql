-- Some managed projects do not preserve custom-role USAGE grants on the
-- protected auth schema. Read the PostgREST JWT subject from request settings
-- through a tiny invoker helper so RAG RPCs and RLS stay SECURITY INVOKER.
create or replace function private.rag_request_user_id()
returns uuid
language sql stable security invoker set search_path = '' as $$
  select coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
revoke all on function private.rag_request_user_id() from PUBLIC, anon;
grant usage on schema private to authenticated, rag_index_worker;
grant execute on function private.rag_request_user_id() to authenticated, rag_index_worker;

drop policy if exists rag_worker_manages_own_index_runs on public.rag_index_runs;
create policy rag_worker_manages_own_index_runs on public.rag_index_runs
  for all to rag_index_worker
  using (started_by = private.rag_request_user_id())
  with check (started_by = private.rag_request_user_id());

drop policy if exists rag_worker_publishes_complete_index_state on public.rag_index_state;
create policy rag_worker_publishes_complete_index_state on public.rag_index_state
  for update to rag_index_worker using (id = true) with check (
    id = true and exists (
      select 1 from public.rag_index_runs r
      where r.id = active_generation and r.started_by = private.rag_request_user_id()
        and r.status = 'completed' and r.checkpoint = r.total_chunks
    )
  );

drop policy if exists rag_worker_reads_own_index_runs on public.rag_index_runs;
create policy rag_worker_reads_own_index_runs on public.rag_index_runs
  for select to rag_index_worker using (started_by = private.rag_request_user_id());

drop policy if exists rag_worker_reads_current_or_own_chunks on public.rag_chunks;
create policy rag_worker_reads_current_or_own_chunks on public.rag_chunks
  for select to rag_index_worker using (
    generation_id = (select s.active_generation from public.rag_index_state s where s.id = true)
    or exists (select 1 from public.rag_index_runs r
      where r.id = rag_chunks.generation_id and r.started_by = private.rag_request_user_id() and r.status in ('running', 'completed'))
    or (generation_id <> (select s.active_generation from public.rag_index_state s where s.id = true)
      and exists (select 1 from public.rag_index_runs r
        where r.id = (select s.active_generation from public.rag_index_state s where s.id = true)
          and r.started_by = private.rag_request_user_id() and r.status = 'completed'))
  );

drop policy if exists rag_worker_stages_own_running_chunks on public.rag_chunks;
create policy rag_worker_stages_own_running_chunks on public.rag_chunks
  for insert to rag_index_worker with check (exists (
    select 1 from public.rag_index_runs r
    where r.id = rag_chunks.generation_id and r.started_by = private.rag_request_user_id() and r.status = 'running'
  ));

drop policy if exists rag_worker_updates_own_running_chunks on public.rag_chunks;
create policy rag_worker_updates_own_running_chunks on public.rag_chunks
  for update to rag_index_worker using (exists (
    select 1 from public.rag_index_runs r
    where r.id = rag_chunks.generation_id and r.started_by = private.rag_request_user_id() and r.status = 'running'
  )) with check (exists (
    select 1 from public.rag_index_runs r
    where r.id = rag_chunks.generation_id and r.started_by = private.rag_request_user_id() and r.status = 'running'
  ));

drop policy if exists rag_worker_deletes_old_chunks_after_publish on public.rag_chunks;
create policy rag_worker_deletes_old_chunks_after_publish on public.rag_chunks
  for delete to rag_index_worker using (
    generation_id <> (select s.active_generation from public.rag_index_state s where s.id = true)
    and exists (select 1 from public.rag_index_runs r
      where r.id = (select s.active_generation from public.rag_index_state s where s.id = true)
        and r.started_by = private.rag_request_user_id() and r.status = 'completed')
  );

create or replace function public.rag_start_index_run(p_corpus_hash text, p_fingerprint text, p_model text, p_total integer)
returns public.rag_index_runs language plpgsql security invoker set search_path = '' as $$
declare result public.rag_index_runs;
begin
  if current_user <> 'rag_index_worker' then
    if not exists (select 1 from public.profiles where id = private.rag_request_user_id() and role = 'owner') then
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
      values (p_corpus_hash, p_fingerprint, p_model, p_total, private.rag_request_user_id()) returning * into result;
  end if;
  return result;
end $$;

create or replace function public.rag_advance_index_run(p_run_id bigint, p_expected integer, p_next integer, p_changed integer, p_reused integer, p_keys text[])
returns public.rag_index_runs language plpgsql security invoker set search_path = '' as $$
declare result public.rag_index_runs;
begin
  if current_user <> 'rag_index_worker' then
    if not exists (select 1 from public.profiles where id = private.rag_request_user_id() and role = 'owner') then
      raise exception 'RAG index worker or owner required';
    end if;
  end if;
  select * into result from public.rag_index_runs where id = p_run_id for update;
  if result.status <> 'running' or result.started_by <> private.rag_request_user_id()
     or result.checkpoint <> p_expected or p_next <= p_expected or p_next > result.total_chunks then
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
  if current_user <> 'rag_index_worker' then
    if not exists (select 1 from public.profiles where id = private.rag_request_user_id() and role = 'owner') then
      raise exception 'RAG index worker or owner required';
    end if;
  end if;
  select * into result from public.rag_index_runs where id = p_run_id for update;
  if result.started_by <> private.rag_request_user_id() or result.status <> 'running'
     or result.checkpoint <> result.total_chunks
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
  if current_user <> 'rag_index_worker' then
    if not exists (select 1 from public.profiles where id = private.rag_request_user_id() and role = 'owner') then
      raise exception 'RAG index worker or owner required';
    end if;
  end if;
  update public.rag_index_runs set status = 'failed', error_message = 'Corpus changed', updated_at = pg_catalog.now()
    where id = p_run_id and started_by = private.rag_request_user_id() and status = 'running';
end $$;
