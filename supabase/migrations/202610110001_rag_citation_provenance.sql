-- Return immutable source provenance with retrieved chunks so API citations can
-- identify the exact chunk revision and span rather than only a page number.
drop function public.match_rag_chunks(extensions.vector, text, integer);

create function public.match_rag_chunks (
  p_embedding extensions.vector(1024), p_embedding_model text, p_match_count integer default 8
) returns table (
  id bigint, chunk_key text, source_page_id bigint, source_revision bigint,
  source_start integer, source_end integer, product_variant_id bigint,
  content text, metadata jsonb, similarity real
) language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.chunk_key, c.source_page_id, c.source_revision,
         c.source_start, c.source_end, c.product_variant_id, c.content, c.metadata,
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

revoke all on function public.match_rag_chunks(extensions.vector, text, integer) from public, anon;
grant execute on function public.match_rag_chunks(extensions.vector, text, integer) to authenticated;
