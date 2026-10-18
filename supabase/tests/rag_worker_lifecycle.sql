-- Isolated LOCAL database only. Real queue RPCs and Auth-hook permissions are
-- exercised under their actual database roles; all fixture changes roll back.
-- The local test runner must be able to SET ROLE supabase_auth_admin as well as
-- rag_index_worker (the bundled supabase_admin local role can do this). This
-- administrative connection is a test harness, never the application worker.
begin;

insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000097', 'authenticated', 'authenticated',
  'rag-worker-lifecycle@example.test', '{}'::jsonb, '{}'::jsonb);
insert into private.rag_worker_identities(user_id)
values ('00000000-0000-4000-8000-000000000097');

set local role supabase_auth_admin;
do $$
declare
  ordinary_event jsonb := '{"user_id":"00000000-0000-4000-8000-000000000096","claims":{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000096","custom":"preserve"}}';
  worker_event jsonb := '{"user_id":"00000000-0000-4000-8000-000000000097","claims":{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000097","custom":"preserve"}}';
  result jsonb;
begin
  if public.rag_worker_access_token_hook(ordinary_event) <> ordinary_event then
    raise exception 'Auth hook modified an ordinary user event';
  end if;
  result := public.rag_worker_access_token_hook(worker_event);
  if result #>> '{claims,role}' <> 'rag_index_worker'
    or (result->'claims') - 'role' <> (worker_event->'claims') - 'role' then
    raise exception 'Auth hook changed more than the registered worker role';
  end if;
end $$;
reset role;

-- Lock this singleton for the duration of the fixture; concurrent workers cannot
-- claim these test revisions, and rollback restores the original queue state.
select 1 from public.rag_index_jobs where job_key = 'verified_catalog' for update;
update public.rag_index_jobs
set status = 'queued', requested_revision = requested_revision + 1,
  attempt_count = 0, max_attempts = 5, available_at = now(),
  lease_token = null, locked_until = null
where job_key = 'verified_catalog';

set local role rag_index_worker;
do $$
declare
  claimed record;
  attempt integer;
  next_status text;
  lease_before uuid;
begin
  for attempt in 1..5 loop
    select * into claimed from public.claim_rag_index_job();
    if not found then raise exception 'worker could not claim attempt %', attempt; end if;
    if (select attempt_count from public.rag_index_jobs where id = claimed.job_id) <> attempt then
      raise exception 'queue attempt count did not advance exactly once';
    end if;
    if exists (select 1 from public.claim_rag_index_job()) then
      raise exception 'a live lease was claimed twice';
    end if;
    if public.heartbeat_rag_index_job(claimed.job_id, gen_random_uuid()) then
      raise exception 'heartbeat accepted an incorrect lease';
    end if;
    if not public.heartbeat_rag_index_job(claimed.job_id, claimed.lease_token) then
      raise exception 'heartbeat rejected the current lease';
    end if;
    next_status := public.fail_rag_index_job(claimed.job_id, claimed.lease_token,
      'FIXTURE_PROVIDER_FAILURE', 'Local regression failure');
    if next_status <> (case when attempt < 5 then 'queued' else 'failed' end) then
      raise exception 'unexpected retry state at attempt %: %', attempt, next_status;
    end if;
    if (select last_error_code from public.rag_index_jobs where id = claimed.job_id) <> 'FIXTURE_PROVIDER_FAILURE'
      or (select last_error_message from public.rag_index_jobs where id = claimed.job_id) <> 'Local regression failure' then
      raise exception 'retry diagnostics were lost';
    end if;
    if exists (select 1 from public.claim_rag_index_job()) then
      raise exception 'retry ignored backoff or exhausted-attempt limit';
    end if;
    -- Advance only the fixture clock boundary instead of waiting or sleeping.
    update public.rag_index_jobs set available_at = now() - interval '1 second'
    where id = claimed.job_id;
  end loop;

  perform public.request_rag_catalog_reindex();
  select * into claimed from public.claim_rag_index_job();
  if not found then raise exception 'a new revision did not recover an exhausted job'; end if;
  lease_before := claimed.lease_token;
  update public.rag_index_jobs set locked_until = now() - interval '1 second'
    where id = claimed.job_id;
  select * into claimed from public.claim_rag_index_job();
  if not found or claimed.lease_token = lease_before then
    raise exception 'expired lease was not reclaimed with a fresh token';
  end if;
  if public.heartbeat_rag_index_job(claimed.job_id, lease_before) then
    raise exception 'reclaimed lease still accepted the prior worker';
  end if;

  perform public.request_rag_catalog_reindex();
  if public.complete_rag_index_job(claimed.job_id, claimed.lease_token, claimed.claimed_revision) <> 'queued' then
    raise exception 'completion discarded a newer requested revision';
  end if;
  select * into claimed from public.claim_rag_index_job();
  if not found then raise exception 'newer revision was not claimable'; end if;
  if public.complete_rag_index_job(claimed.job_id, claimed.lease_token, claimed.claimed_revision) <> 'completed' then
    raise exception 'latest revision did not complete';
  end if;
  if exists (select 1 from public.claim_rag_index_job()) then
    raise exception 'completed work was processed again without a new request';
  end if;
  begin
    perform public.complete_rag_index_job(claimed.job_id, claimed.lease_token, claimed.claimed_revision);
    raise exception 'duplicate completion accepted a released lease';
  exception when others then
    if sqlerrm <> 'RAG job lease expired or changed' then raise; end if;
  end;
end $$;
reset role;

rollback;
