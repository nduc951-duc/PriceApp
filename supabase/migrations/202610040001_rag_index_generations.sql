-- Stage complete generations and publish them atomically. Generation 0 is the legacy index.
create table public.rag_index_state (
  id boolean primary key default true check (id),
  active_generation bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.rag_index_state (id) values (true) on conflict do nothing;

create table public.rag_index_runs (
  id bigint generated always as identity primary key,
  status text not null default 'running' check (status in ('running', 'failed', 'completed')),
  corpus_hash text not null,
  fingerprint text not null,
  model text not null,
  total_chunks integer not null check (total_chunks >= 0),
  checkpoint integer not null default 0 check (checkpoint >= 0),
  changed integer not null default 0,
  reused integer not null default 0,
  removed integer not null default 0,
  error_message text,
  started_by uuid not null references auth.users(id),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index rag_index_one_running_run on public.rag_index_runs ((true)) where status = 'running';

alter table public.rag_chunks add column generation_id bigint not null default 0;
alter table public.rag_chunks add column embedding_fingerprint text;
alter table public.rag_chunks drop constraint rag_chunks_chunk_key_key;
alter table public.rag_chunks add constraint rag_chunks_generation_key unique (generation_id, chunk_key);
create index rag_chunks_generation_idx on public.rag_chunks (generation_id);

alter table public.rag_index_state enable row level security;
alter table public.rag_index_runs enable row level security;
grant select on public.rag_index_state, public.rag_index_runs to authenticated;
grant insert, update, delete on public.rag_chunks to authenticated;
grant usage, select on sequence public.rag_index_runs_id_seq to authenticated;
create policy "authenticated read rag index state" on public.rag_index_state for select to authenticated using (auth.uid() is not null);
create policy "owners read rag index runs" on public.rag_index_runs for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

-- Restrict all chunk reads, including direct REST reads, to the published generation.
drop policy "authenticated read current rag chunks" on public.rag_chunks;
create policy "authenticated read published rag chunks" on public.rag_chunks for select to authenticated using (
  generation_id = (select active_generation from public.rag_index_state where id = true)
  and public.rag_chunk_is_current(source_page_id, product_variant_id, source_revision, metadata->>'kind')
);
create policy "owner reads staged rag chunks" on public.rag_chunks for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);

create or replace function public.match_rag_chunks (
  p_embedding extensions.vector(1024), p_embedding_model text, p_match_count integer default 8
) returns table (
  id bigint, chunk_key text, source_page_id bigint, product_variant_id bigint,
  content text, metadata jsonb, similarity real
) language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.chunk_key, c.source_page_id, c.product_variant_id, c.content, c.metadata,
         (1 - (c.embedding <=> p_embedding))::real
  from public.rag_chunks c
  where auth.uid() is not null
    and c.generation_id = (select active_generation from public.rag_index_state where id = true)
    and c.embedding_model = p_embedding_model
    and vector_dims(c.embedding) = vector_dims(p_embedding)
    and public.rag_chunk_is_current(c.source_page_id, c.product_variant_id, c.source_revision, c.metadata->>'kind')
  order by c.embedding <=> p_embedding
  limit least(greatest(coalesce(p_match_count, 8), 1), 20)
$$;

-- RPCs serialize run ownership and checkpoint updates; the worker uses the caller's JWT.
create function public.rag_start_index_run(p_corpus_hash text, p_fingerprint text, p_model text, p_total integer)
returns public.rag_index_runs language plpgsql security definer set search_path = public as $$
declare result public.rag_index_runs;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then
    raise exception 'Owner required';
  end if;
  perform pg_advisory_xact_lock(9041001);
  select * into result from public.rag_index_runs where status = 'running' for update;
  if found then
    if result.updated_at > now() - interval '10 minutes' then return result; end if;
    update public.rag_index_runs set status = 'failed', error_message = 'Worker timeout', updated_at = now() where id = result.id;
  end if;
  select * into result from public.rag_index_runs
    where status = 'failed' and corpus_hash = p_corpus_hash and fingerprint = p_fingerprint
    order by id desc limit 1 for update;
  if found then
    update public.rag_index_runs set status = 'running', error_message = null, updated_at = now()
      where id = result.id returning * into result;
  else
    insert into public.rag_index_runs (corpus_hash, fingerprint, model, total_chunks, started_by)
      values (p_corpus_hash, p_fingerprint, p_model, p_total, auth.uid()) returning * into result;
  end if;
  return result;
end $$;

create function public.rag_advance_index_run(p_run_id bigint, p_expected integer, p_next integer, p_changed integer, p_reused integer, p_keys text[])
returns public.rag_index_runs language plpgsql security definer set search_path = public as $$
declare result public.rag_index_runs;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then raise exception 'Owner required'; end if;
  select * into result from public.rag_index_runs where id = p_run_id for update;
  if result.status <> 'running' or result.checkpoint <> p_expected or p_next <= p_expected or p_next > result.total_chunks then
    raise exception 'Index checkpoint conflict';
  end if;
  if cardinality(p_keys) <> p_next - p_expected
     or (select count(*) from public.rag_chunks where generation_id = p_run_id and chunk_key = any(p_keys)) <> cardinality(p_keys)
     or (select count(*) from public.rag_chunks where generation_id = p_run_id) < p_next then
    raise exception 'Incomplete staged batch';
  end if;
  update public.rag_index_runs set checkpoint = p_next, changed = changed + p_changed,
    reused = reused + p_reused, updated_at = now() where id = p_run_id returning * into result;
  return result;
end $$;

create function public.rag_publish_index_run(p_run_id bigint)
returns public.rag_index_runs language plpgsql security definer set search_path = public as $$
declare result public.rag_index_runs; old_generation bigint;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then raise exception 'Owner required'; end if;
  select * into result from public.rag_index_runs where id = p_run_id for update;
  if result.status <> 'running' or result.checkpoint <> result.total_chunks
     or (select count(*) from public.rag_chunks where generation_id = p_run_id) <> result.total_chunks then
    raise exception 'Index generation incomplete';
  end if;
  select active_generation into old_generation from public.rag_index_state where id = true for update;
  update public.rag_index_state set active_generation = p_run_id, updated_at = now() where id = true;
  update public.rag_index_runs set status = 'completed', completed_at = now(), updated_at = now(),
    removed = (select count(*) from public.rag_chunks where generation_id = old_generation and chunk_key not in
      (select chunk_key from public.rag_chunks where generation_id = p_run_id))
    where id = p_run_id returning * into result;
  delete from public.rag_chunks where generation_id <> p_run_id;
  return result;
end $$;

create function public.rag_abandon_index_run(p_run_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') then raise exception 'Owner required'; end if;
  update public.rag_index_runs set status = 'failed', error_message = 'Corpus changed', updated_at = now()
    where id = p_run_id and status = 'running';
end $$;

revoke all on function public.rag_start_index_run(text,text,text,integer), public.rag_advance_index_run(bigint,integer,integer,integer,integer,text[]), public.rag_publish_index_run(bigint), public.rag_abandon_index_run(bigint) from public, anon;
grant execute on function public.rag_start_index_run(text,text,text,integer), public.rag_advance_index_run(bigint,integer,integer,integer,integer,text[]), public.rag_publish_index_run(bigint), public.rag_abandon_index_run(bigint) to authenticated;
