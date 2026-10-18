-- The catalog-only indexer may read source-page metadata only when the page
-- is linked to an active verified variant. Do not consult retired OCR tables.
drop policy if exists rag_worker_reads_source_pages on public.source_pages;
create policy rag_worker_reads_source_pages on public.source_pages
  for select to rag_index_worker using (
    verification_status <> 'unreadable'
    and exists (
      select 1
      from public.variant_sources s
      join public.product_variants v on v.id = s.variant_id
      where s.source_page_id = source_pages.id
        and v.active
        and v.verification_status = 'verified'
    )
  );
