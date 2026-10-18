-- Regression: verified Supabase rows need neither OCR, source images nor prices.
begin;
do $$
declare category_id bigint; product_id bigint; variant_id bigint; hidden_id bigint; source_page_id bigint; orphan_source_page_id bigint;
begin
  if to_regclass('public.rag_page_texts') is not null then raise exception 'OCR transcript table still exists'; end if;
  if exists (
    select 1 from public.rag_chunks
    where metadata->>'kind' = 'approved_page_ocr'
       or chunk_key ~ '^page:[0-9]+:ocr:[0-9]+$'
  ) then raise exception 'OCR transcript embeddings remain'; end if;
  insert into public.categories(name, slug) values ('Catalog-only fixture', 'catalog-only-' || txid_current()) returning id into category_id;
  insert into public.products(category_id, name, description)
    values(category_id, 'Catalog-only fixture ' || txid_current(), 'brass description lookup token for grounding tests') returning id into product_id;
  insert into public.product_variants(product_id, display_name, raw_specification, search_text, attributes, verification_status)
    values(product_id, 'Verified fixture 8x60', '8x60', 'catalog-only fixture', '{"material":"steel"}', 'verified') returning id into variant_id;
  insert into public.product_variants(product_id, display_name, verification_status)
    values(product_id, 'Hidden fixture', 'needs_review') returning id into hidden_id;
  insert into public.packaging_options(variant_id, name, quantity, base_unit) values(variant_id, 'Bag', 10, 'piece');
  insert into public.source_pages(page_number, storage_path, verification_status)
    values (987, 'catalog-only-' || txid_current() || '.jpg', 'verified') returning id into source_page_id;
  insert into public.variant_sources(variant_id, source_page_id) values (variant_id, source_page_id);
  insert into public.source_pages(page_number, storage_path, verification_status)
    values (988, 'catalog-orphan-' || txid_current() || '.jpg', 'needs_review') returning id into orphan_source_page_id;
  perform set_config('test.catalog_only_variant', variant_id::text, true);
  perform set_config('test.catalog_only_hidden', hidden_id::text, true);
  perform set_config('test.catalog_only_source_page', source_page_id::text, true);
  perform set_config('test.catalog_only_orphan_source_page', orphan_source_page_id::text, true);
  if not public.rag_chunk_is_current(null, variant_id, null, 'verified_catalog') then raise exception 'Page-free verified catalog row is not current'; end if;
  if public.rag_chunk_is_current(null, variant_id, 1, 'approved_page_ocr') then raise exception 'OCR evidence is still accepted'; end if;
  if public.rag_chunk_is_current(null, hidden_id, null, 'verified_catalog') then raise exception 'Unverified variant is current'; end if;
  if exists (
    select 1 from pg_catalog.pg_trigger
    where not tgisinternal and (
      (tgrelid = 'public.source_pages'::regclass and tgname = 'source_pages_queue_rag_index')
      or (tgrelid = 'public.variant_sources'::regclass and tgname = 'variant_sources_queue_rag_index')
      or (tgrelid = 'public.prices'::regclass and tgname = 'prices_queue_rag_index')
    )
  ) then raise exception 'OCR, source-page, or price changes still enqueue catalog embeddings'; end if;
end $$;
set local role rag_index_worker;
do $$
declare linked_count integer; orphan_count integer;
begin
  select count(*) into linked_count from public.source_pages
    where id = current_setting('test.catalog_only_source_page')::bigint;
  if linked_count <> 1 then raise exception 'Worker cannot read source metadata linked to a verified catalog variant'; end if;
  select count(*) into orphan_count from public.source_pages
    where id = current_setting('test.catalog_only_orphan_source_page')::bigint;
  if orphan_count <> 0 then raise exception 'Worker can read a source page without a verified catalog variant'; end if;
end $$;
reset role;
set local role anon;
do $$
declare row_count integer; material text; description text; hidden_count integer;
begin
  select count(*), max(attributes->>'material'), max(product_description) into row_count, material, description
    from public.get_public_rag_catalog(array[current_setting('test.catalog_only_variant')::bigint]);
  if row_count <> 1 or material <> 'steel' or description <> 'brass description lookup token for grounding tests' then
    raise exception 'Guest cannot read page-free product and variant facts';
  end if;
  if not exists (
    select 1 from public.search_public_rag_catalog('brass description lookup token', 8)
    where id = current_setting('test.catalog_only_variant')::bigint
  ) then raise exception 'Guest product-description search did not return its verified variant'; end if;
  if exists(select 1 from public.get_public_rag_catalog(array[current_setting('test.catalog_only_variant')::bigint]) where price_id is not null) then
    raise exception 'Price-free variant acquired an invented price';
  end if;
  select count(*) into hidden_count from public.get_public_rag_catalog(array[current_setting('test.catalog_only_hidden')::bigint]);
  if hidden_count <> 0 then raise exception 'Unverified guest data exposed'; end if;
end $$;
reset role;
rollback;
