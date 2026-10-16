-- Public reads stay behind the scoped SECURITY DEFINER customer/RAG RPCs.
-- Keep the four public RAG EXECUTE grants and all authenticated/worker ACLs intact.
revoke all privileges on table public.prices, public.rag_chunks from anon;
