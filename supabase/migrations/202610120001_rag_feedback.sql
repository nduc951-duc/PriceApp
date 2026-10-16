create table public.rag_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.rag_conversations(id) on delete cascade,
  assistant_message_id uuid not null references public.rag_conversation_messages(id) on delete cascade,
  helpful boolean not null,
  reason text check (reason in ('missing_data', 'retrieval_error', 'answer_error', 'other')),
  created_at timestamptz not null default now(),
  constraint rag_feedback_reason_required check (helpful or reason is not null),
  constraint rag_feedback_one_per_message unique (user_id, assistant_message_id)
);

create index rag_feedback_created_reason_idx on public.rag_feedback(created_at desc, reason);
alter table public.rag_feedback enable row level security;
alter table public.rag_feedback force row level security;
revoke all on public.rag_feedback from public, anon, authenticated;
grant select, insert on public.rag_feedback to authenticated;

create policy rag_feedback_select_own on public.rag_feedback
  for select to authenticated using (user_id = (select auth.uid()));
create policy rag_feedback_insert_own on public.rag_feedback
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.rag_conversations c
      where c.id = conversation_id and c.owner_id = (select auth.uid())
    )
    and exists (
      select 1 from public.rag_conversation_messages m
      where m.id = assistant_message_id and m.conversation_id = rag_feedback.conversation_id and m.role = 'assistant'
    )
  );
create policy rag_feedback_owner_read on public.rag_feedback
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner')
  );
