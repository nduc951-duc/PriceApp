-- Read-only L4 schema and run audit for the Supabase SQL Editor.
-- Run after 202610040001_rag_index_generations.sql. Do not paste secrets here.
select
  to_regclass('public.rag_index_runs') as runs_table,
  to_regclass('public.rag_index_state') as state_table,
  to_regclass('public.rag_chunks') as chunks_table;

select proname, oidvectortypes(proargtypes) as arguments
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'rag_start_index_run', 'rag_advance_index_run',
    'rag_publish_index_run', 'rag_abandon_index_run', 'match_rag_chunks'
  )
order by proname;

select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('rag_chunks', 'rag_index_runs', 'rag_index_state')
order by tablename, policyname;

select s.active_generation, s.updated_at,
       count(c.id) filter (where c.generation_id = s.active_generation) as active_chunks,
       count(c.id) filter (where c.generation_id <> s.active_generation) as staged_chunks
from public.rag_index_state s
left join public.rag_chunks c on true
where s.id = true
group by s.active_generation, s.updated_at;

select id, status, corpus_hash, fingerprint, model, total_chunks,
       checkpoint, changed, reused, removed, started_at, updated_at, completed_at
from public.rag_index_runs
order by id desc
limit 5;
