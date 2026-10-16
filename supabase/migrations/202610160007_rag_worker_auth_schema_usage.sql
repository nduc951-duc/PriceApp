-- Invoker RPCs call auth.uid() and auth.role() to enforce worker identity and
-- row ownership. Keep namespace access explicit for the dedicated worker role.
grant usage on schema auth to rag_index_worker;
