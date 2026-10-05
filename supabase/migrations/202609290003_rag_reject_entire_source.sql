-- Rejecting an entire page invalidates OCR and catalog chunks tied to it.
create or replace function public.rag_chunk_is_current(
  p_source_page_id bigint,
  p_product_variant_id bigint,
  p_source_revision bigint,
  p_kind text
) returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.source_pages s
    where s.id = p_source_page_id
      and s.verification_status <> 'unreadable'
      and not exists (
        select 1 from public.rag_page_texts rejected
        where rejected.source_page_id = s.id
          and rejected.review_status = 'rejected'
      )
  ) and case
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

-- The lexical path must obey the same source revocation rule as vector retrieval.
create or replace function public.current_rag_variant_sources(p_variant_ids bigint[])
returns table (product_variant_id bigint, source_page_id bigint, page_number integer)
language sql stable security definer set search_path = public as $$
  select v.id, s.source_page_id, page.page_number
  from public.product_variants v
  join public.variant_sources s on s.variant_id = v.id
  join public.source_pages page on page.id = s.source_page_id
  left join public.rag_page_texts t on t.source_page_id = page.id
  where auth.uid() is not null
    and v.id = any(p_variant_ids)
    and v.active and v.verification_status = 'verified'
    and page.verification_status <> 'unreadable'
    and coalesce(t.review_status, 'draft') <> 'rejected';
$$;

revoke all on function public.current_rag_variant_sources(bigint[]) from public, anon;
grant execute on function public.current_rag_variant_sources(bigint[]) to authenticated;
