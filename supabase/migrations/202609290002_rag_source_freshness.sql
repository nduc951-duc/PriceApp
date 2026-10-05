-- A chunk is usable only while its originating review is still current.
-- Existing OCR chunks deliberately have no revision and need a fresh index run.
alter table public.rag_page_texts
  add column revision bigint not null default 1 check (revision > 0);

alter table public.rag_chunks
  add column source_revision bigint check (source_revision > 0);

create or replace function public.bump_rag_page_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.title, new.extracted_text, new.review_status)
     is distinct from (old.title, old.extracted_text, old.review_status) then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

create trigger rag_page_revision_before_update
before update on public.rag_page_texts
for each row execute function public.bump_rag_page_revision();

create or replace function public.rag_chunk_is_current(
  p_source_page_id bigint,
  p_product_variant_id bigint,
  p_source_revision bigint,
  p_kind text
) returns boolean language sql stable security invoker
set search_path = public as $$
  select case
    when p_kind = 'approved_page_ocr' then exists (
      select 1 from public.rag_page_texts t
      where t.source_page_id = p_source_page_id
        and t.review_status = 'approved'
        and t.revision = p_source_revision
    )
    when p_kind = 'verified_catalog' then exists (
      select 1 from public.product_variants v
      join public.variant_sources s on s.variant_id = v.id
      where v.id = p_product_variant_id
        and s.source_page_id = p_source_page_id
        and v.active and v.verification_status = 'verified'
    )
    else false
  end;
$$;

revoke all on function public.rag_chunk_is_current(bigint, bigint, bigint, text) from public, anon;
grant execute on function public.rag_chunk_is_current(bigint, bigint, bigint, text) to authenticated;

drop policy "authenticated read rag chunks" on public.rag_chunks;
create policy "authenticated read current rag chunks" on public.rag_chunks
for select to authenticated using (
  public.rag_chunk_is_current(source_page_id, product_variant_id, source_revision, metadata->>'kind')
);

create or replace function public.match_rag_chunks (
  p_embedding extensions.vector(1024),
  p_embedding_model text,
  p_match_count integer default 8
) returns table (
  id bigint,
  chunk_key text,
  source_page_id bigint,
  product_variant_id bigint,
  content text,
  metadata jsonb,
  similarity real
) language sql stable security invoker
set search_path = public, extensions
as $$
  select c.id, c.chunk_key, c.source_page_id, c.product_variant_id, c.content, c.metadata,
         (1 - (c.embedding <=> p_embedding))::real as similarity
  from public.rag_chunks c
  where auth.uid() is not null
    and c.embedding_model = p_embedding_model
    and vector_dims(c.embedding) = vector_dims(p_embedding)
    and public.rag_chunk_is_current(c.source_page_id, c.product_variant_id,
      c.source_revision, c.metadata->>'kind')
  order by c.embedding <=> p_embedding
  limit least(greatest(coalesce(p_match_count, 8), 1), 20)
$$;
