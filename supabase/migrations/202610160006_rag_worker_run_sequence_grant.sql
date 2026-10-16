-- The worker inserts index runs through SECURITY INVOKER RPCs. It therefore
-- needs the sequence privileges normally granted to authenticated users.
grant usage, select on sequence public.rag_index_runs_id_seq to rag_index_worker;
