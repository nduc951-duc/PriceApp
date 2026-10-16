drop policy if exists "authenticated read approved rag pages" on public.rag_page_texts;
create policy "authenticated read rag pages for OCR" on public.rag_page_texts
  for select to authenticated using (true);

create policy "authenticated create rag OCR drafts" on public.rag_page_texts
  for insert to authenticated with check (review_status = 'draft');

create policy "authenticated update rag OCR drafts" on public.rag_page_texts
  for update to authenticated using (review_status = 'draft') with check (review_status = 'draft');
