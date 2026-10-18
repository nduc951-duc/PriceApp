-- OCR is retired. Delete OCR transcripts and their embeddings while preserving
-- source-page images and catalog provenance linked to verified variants.
delete from public.rag_chunks
where metadata->>'kind' = 'approved_page_ocr'
   or chunk_key ~ '^page:[0-9]+:ocr:[0-9]+$';

drop table public.rag_page_texts;
drop function if exists public.bump_rag_page_revision();
