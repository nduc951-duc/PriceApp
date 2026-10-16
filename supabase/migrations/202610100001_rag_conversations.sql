create table if not exists public.rag_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  constraint rag_conversations_owner_matches_session check (owner_id = auth.uid())
);

create table if not exists public.rag_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.rag_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint rag_conversation_message_shape check (
    (role = 'user' and content is not null and char_length(content) between 1 and 4000)
    or (role = 'assistant' and content is null)
  ),
  constraint rag_conversation_message_metadata_object check (
    jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192
  ),
  constraint rag_conversation_message_metadata_keys check (
    metadata - array['status', 'confirmedAttributes', 'variantIds', 'priceIds']::text[] = '{}'::jsonb
  )
);

create index if not exists rag_conversations_owner_created_idx
  on public.rag_conversations(owner_id, created_at desc);
create index if not exists rag_conversation_messages_conversation_created_idx
  on public.rag_conversation_messages(conversation_id, created_at);

alter table public.rag_conversations enable row level security;
alter table public.rag_conversations force row level security;
alter table public.rag_conversation_messages enable row level security;
alter table public.rag_conversation_messages force row level security;

drop policy if exists rag_conversations_select_own on public.rag_conversations;
create policy rag_conversations_select_own on public.rag_conversations
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists rag_conversations_insert_own on public.rag_conversations;
create policy rag_conversations_insert_own on public.rag_conversations
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists rag_conversation_messages_select_own on public.rag_conversation_messages;
create policy rag_conversation_messages_select_own on public.rag_conversation_messages
  for select to authenticated using (
    exists (
      select 1 from public.rag_conversations
      where rag_conversations.id = rag_conversation_messages.conversation_id
        and rag_conversations.owner_id = (select auth.uid())
    )
  );
drop policy if exists rag_conversation_messages_insert_own on public.rag_conversation_messages;
create policy rag_conversation_messages_insert_own on public.rag_conversation_messages
  for insert to authenticated with check (
    exists (
      select 1 from public.rag_conversations
      where rag_conversations.id = rag_conversation_messages.conversation_id
        and rag_conversations.owner_id = (select auth.uid())
    )
  );

revoke all on public.rag_conversations from public, anon, authenticated;
revoke all on public.rag_conversation_messages from public, anon, authenticated;
grant select, insert on table public.rag_conversations to authenticated;
grant select, insert on table public.rag_conversation_messages to authenticated;
