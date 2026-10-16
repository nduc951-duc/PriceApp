create table public.rag_index_jobs (
  id bigint generated always as identity primary key,
  job_key text not null unique check (job_key = 'verified_catalog'),
  status text not null default 'completed' check (status in ('queued', 'running', 'completed', 'failed')),
  requested_revision bigint not null default 0 check (requested_revision >= 0),
  claimed_revision bigint not null default 0 check (claimed_revision >= 0),
  completed_revision bigint not null default 0 check (completed_revision >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'running') = (lease_token is not null and locked_until is not null))
);
insert into public.rag_index_jobs (job_key) values ('verified_catalog') on conflict (job_key) do nothing;
alter table public.rag_index_jobs enable row level security;
revoke all on public.rag_index_jobs from public, anon, authenticated;
grant select, update on public.rag_index_jobs to rag_index_worker;
grant select on public.rag_index_jobs to authenticated;
create policy rag_worker_reads_verified_catalog_job on public.rag_index_jobs
  for select to rag_index_worker using (job_key = 'verified_catalog');
create policy rag_worker_updates_verified_catalog_job on public.rag_index_jobs
  for update to rag_index_worker using (job_key = 'verified_catalog')
  with check (job_key = 'verified_catalog');
create policy owners_read_verified_catalog_job on public.rag_index_jobs
  for select to authenticated using (
    job_key = 'verified_catalog' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'
    )
  );

create or replace function private.queue_verified_catalog_index()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.verification_status = 'verified'
     and (tg_op = 'INSERT' or old.verification_status is distinct from 'verified') then
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
  end if;
  return new;
end
$$;
revoke all on function private.queue_verified_catalog_index() from public, anon, authenticated, rag_index_worker;
create trigger product_variants_queue_verified_rag_index
  after insert or update of verification_status on public.product_variants
  for each row execute function private.queue_verified_catalog_index();

create or replace function public.claim_rag_index_job()
returns table (job_id bigint, requested_revision bigint, claimed_revision bigint, lease_token uuid)
language plpgsql security invoker set search_path = '' as $$
begin
  update public.rag_index_jobs j set status = 'failed', lease_token = null, locked_until = null,
    last_error_code = 'WORKER_LEASE_EXHAUSTED',
    last_error_message = 'Worker lease expired after the configured retry limit.', updated_at = pg_catalog.now()
    where j.job_key = 'verified_catalog' and j.status = 'running'
      and j.locked_until < pg_catalog.now() and j.attempt_count >= j.max_attempts;
  return query
    update public.rag_index_jobs j set
      status = 'running', claimed_revision = j.requested_revision,
      attempt_count = j.attempt_count + 1, lease_token = gen_random_uuid(),
      locked_until = pg_catalog.now() + interval '10 minutes', updated_at = pg_catalog.now()
    where j.job_key = 'verified_catalog'
      and j.attempt_count < j.max_attempts
      and ((j.status = 'queued' and j.available_at <= pg_catalog.now())
        or (j.status = 'running' and j.locked_until < pg_catalog.now()))
    returning j.id, j.requested_revision, j.claimed_revision, j.lease_token;
end
$$;

create or replace function public.heartbeat_rag_index_job(p_job_id bigint, p_lease_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  update public.rag_index_jobs set locked_until = pg_catalog.now() + interval '10 minutes', updated_at = pg_catalog.now()
    where id = p_job_id and job_key = 'verified_catalog' and status = 'running' and lease_token = p_lease_token;
  get diagnostics affected = row_count;
  return affected = 1;
end
$$;

create or replace function public.complete_rag_index_job(p_job_id bigint, p_lease_token uuid, p_claimed_revision bigint)
returns text language plpgsql security invoker set search_path = '' as $$
declare next_status text;
begin
  update public.rag_index_jobs set
    status = case when requested_revision > p_claimed_revision then 'queued' else 'completed' end,
    completed_revision = greatest(completed_revision, p_claimed_revision),
    attempt_count = case when requested_revision > p_claimed_revision then attempt_count else 0 end,
    lease_token = null, locked_until = null, available_at = pg_catalog.now(),
    last_error_code = null, last_error_message = null, updated_at = pg_catalog.now()
    where id = p_job_id and job_key = 'verified_catalog' and status = 'running' and lease_token = p_lease_token
      and claimed_revision = p_claimed_revision
    returning status into next_status;
  if next_status is null then raise exception 'RAG job lease expired or changed'; end if;
  return next_status;
end
$$;

create or replace function public.fail_rag_index_job(
  p_job_id bigint, p_lease_token uuid, p_error_code text, p_error_message text
) returns text language plpgsql security invoker set search_path = '' as $$
declare next_status text;
begin
  update public.rag_index_jobs set
    status = case when requested_revision > claimed_revision or attempt_count < max_attempts then 'queued' else 'failed' end,
    attempt_count = case when requested_revision > claimed_revision then 0 else attempt_count end,
    available_at = pg_catalog.now() + case when requested_revision > claimed_revision then interval '0 seconds'
      else least(interval '10 minutes', interval '5 seconds' * (2 ^ least(attempt_count - 1, 7))) end,
    lease_token = null, locked_until = null,
    last_error_code = left(coalesce(nullif(p_error_code, ''), 'INDEX_BATCH_FAILED'), 80),
    last_error_message = left(coalesce(nullif(p_error_message, ''), 'Index batch failed.'), 500),
    updated_at = pg_catalog.now()
    where id = p_job_id and job_key = 'verified_catalog' and status = 'running' and lease_token = p_lease_token
    returning status into next_status;
  if next_status is null then raise exception 'RAG job lease expired or changed'; end if;
  return next_status;
end
$$;

create or replace function public.request_rag_catalog_reindex()
returns bigint language plpgsql security invoker set search_path = '' as $$
declare next_revision bigint;
begin
  update public.rag_index_jobs set requested_revision = requested_revision + 1,
    status = case when status = 'running' then 'running' else 'queued' end,
    attempt_count = case when status = 'running' then attempt_count else 0 end,
    available_at = pg_catalog.now(), last_error_code = null, last_error_message = null, updated_at = pg_catalog.now()
    where job_key = 'verified_catalog' returning requested_revision into next_revision;
  return next_revision;
end
$$;

revoke all on function public.claim_rag_index_job(), public.heartbeat_rag_index_job(bigint,uuid),
  public.complete_rag_index_job(bigint,uuid,bigint), public.fail_rag_index_job(bigint,uuid,text,text),
  public.request_rag_catalog_reindex() from public, anon, authenticated;
grant execute on function public.claim_rag_index_job(), public.heartbeat_rag_index_job(bigint,uuid),
  public.complete_rag_index_job(bigint,uuid,bigint), public.fail_rag_index_job(bigint,uuid,text,text),
  public.request_rag_catalog_reindex() to rag_index_worker;
