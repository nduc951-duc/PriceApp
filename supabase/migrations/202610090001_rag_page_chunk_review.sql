alter table public.rag_page_texts
  add column chunk_settings jsonb not null default '{"maxCharacters":1100,"overlapCharacters":160}'::jsonb,
  add column chunk_links jsonb not null default '{}'::jsonb,
  add constraint rag_page_chunk_settings_object check (
    jsonb_typeof(chunk_settings) = 'object'
    and (chunk_settings->>'maxCharacters')::integer between 200 and 4000
    and (chunk_settings->>'overlapCharacters')::integer >= 0
    and (chunk_settings->>'overlapCharacters')::integer < (chunk_settings->>'maxCharacters')::integer
  ),
  add constraint rag_page_chunk_links_object check (jsonb_typeof(chunk_links) = 'object');

alter table public.rag_chunks
  add column chunker_version text not null default 'lines-1100-overlap160-v2',
  add column source_start integer,
  add column source_end integer,
  add constraint rag_chunk_source_span_valid check (
    (source_start is null and source_end is null) or
    (source_start >= 0 and source_end > source_start)
  );

create or replace function public.bump_rag_page_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.title, new.extracted_text, new.review_status, new.chunk_settings, new.chunk_links)
     is distinct from (old.title, old.extracted_text, old.review_status, old.chunk_settings, old.chunk_links) then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;
  end if;
  return new;
end;
$$;

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
    ) and (
      p_product_variant_id is null or exists (
        select 1 from public.product_variants v
        join public.variant_sources s on s.variant_id = v.id
        where v.id = p_product_variant_id and s.source_page_id = p_source_page_id
          and v.active and v.verification_status = 'verified'
      )
    )
    when p_kind = 'verified_catalog' then exists (
      select 1 from public.product_variants v
      join public.variant_sources s on s.variant_id = v.id
      where v.id = p_product_variant_id and s.source_page_id = p_source_page_id
        and v.active and v.verification_status = 'verified'
    )
    else false
  end;
$$;

create index rag_chunks_source_updated_idx
  on public.rag_chunks (generation_id, source_page_id, updated_at desc);
