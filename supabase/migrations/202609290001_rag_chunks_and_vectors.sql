create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated;

create table public.rag_page_texts (
  source_page_id bigint primary key references public.source_pages(id) on delete cascade,
  title text not null default '',
  extracted_text text not null default '',
  review_status text not null default 'draft' check (review_status in ('draft', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (review_status <> 'approved' or (reviewed_by is not null and reviewed_at is not null))
);

insert into public.rag_page_texts (source_page_id, title)
select id, 'Sổ giá - Trang ' || coalesce(page_number::text, '?')
from public.source_pages
on conflict (source_page_id) do nothing;

create table public.rag_chunks (
  id bigint generated always as identity primary key,
  chunk_key text not null unique,
  source_page_id bigint not null references public.source_pages(id) on delete cascade,
  product_variant_id bigint references public.product_variants(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(btrim(content)) > 0),
  content_hash text not null,
  embedding extensions.vector(1024) not null,
  embedding_model text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rag_chunks_source_page_idx on public.rag_chunks (source_page_id);
create index rag_chunks_product_variant_idx on public.rag_chunks (product_variant_id) where product_variant_id is not null;
create index rag_chunks_embedding_hnsw_idx on public.rag_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.rag_page_texts enable row level security;
alter table public.rag_chunks enable row level security;

grant select, insert, update, delete on public.rag_page_texts, public.rag_chunks to authenticated;
grant usage, select on sequence public.rag_chunks_id_seq to authenticated;

create policy "authenticated read approved rag pages" on public.rag_page_texts for select to authenticated using (
  review_status = 'approved' or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner', 'editor')
  )
);
create policy "owners manage rag page text" on public.rag_page_texts for all to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
);
create policy "authenticated read rag chunks" on public.rag_chunks for select to authenticated using (true);
create policy "owners manage rag chunks" on public.rag_chunks for all to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
) with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner')
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
  order by c.embedding <=> p_embedding
  limit least(greatest(coalesce(p_match_count, 8), 1), 20)
$$;

revoke all on function public.match_rag_chunks(extensions.vector(1024), text, integer) from public, anon;
grant execute on function public.match_rag_chunks(extensions.vector(1024), text, integer) to authenticated;

