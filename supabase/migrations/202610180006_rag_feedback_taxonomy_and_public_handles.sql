alter table public.rag_feedback drop constraint if exists rag_feedback_reason_check;
alter table public.rag_feedback
  add constraint rag_feedback_reason_check check (reason in (
    'missing_data', 'wrong_product_specification', 'wrong_price_or_unit',
    'missing_or_incorrect_citation', 'retrieval_or_provider_failure',
    'retrieval_error', 'answer_error', 'other'
  ));

create table public.rag_public_feedback (
  id bigint generated always as identity primary key,
  response_id uuid not null unique,
  helpful boolean not null,
  reason text check (reason in (
    'missing_data', 'wrong_product_specification', 'wrong_price_or_unit',
    'missing_or_incorrect_citation', 'retrieval_or_provider_failure',
    'retrieval_error', 'answer_error', 'other'
  )),
  created_at timestamptz not null default now(),
  constraint rag_public_feedback_reason_required check (helpful or reason is not null)
);

create index rag_public_feedback_created_reason_idx on public.rag_public_feedback(created_at desc, reason);
alter table public.rag_public_feedback enable row level security;
alter table public.rag_public_feedback force row level security;
revoke all on public.rag_public_feedback from public, anon, authenticated;
grant select on public.rag_public_feedback to authenticated;
create policy rag_public_feedback_owner_read on public.rag_public_feedback
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner')
  );

create table private.rag_public_feedback_security (
  singleton boolean primary key default true check (singleton),
  hmac_secret text not null check (char_length(hmac_secret) >= 32)
);
revoke all on private.rag_public_feedback_security from public, anon, authenticated;

create or replace function public.submit_public_rag_feedback(
  p_response_id uuid,
  p_expires_at bigint,
  p_signature text,
  p_helpful boolean,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_now bigint;
begin
  select hmac_secret into v_secret from private.rag_public_feedback_security where singleton = true;
  if v_secret is null then
    raise exception 'feedback_not_configured' using errcode = '55000';
  end if;

  v_now := floor(extract(epoch from clock_timestamp()))::bigint;
  if p_response_id is null or p_expires_at is null or p_signature is null
    or p_signature !~ '^[0-9a-f]{64}$'
    or p_expires_at <= v_now or p_expires_at > v_now + 1800
    or encode(extensions.hmac(convert_to(p_response_id::text || '|' || p_expires_at::text, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex') <> p_signature then
    raise exception 'invalid_submission_signature' using errcode = '42501';
  end if;

  if p_helpful is null or (p_helpful and p_reason is not null)
    or (not p_helpful and (p_reason is null or p_reason not in (
      'missing_data', 'wrong_product_specification', 'wrong_price_or_unit',
      'missing_or_incorrect_citation', 'retrieval_or_provider_failure',
      'retrieval_error', 'answer_error', 'other'
    ))) then
    raise exception 'invalid_feedback_reason' using errcode = '22023';
  end if;

  insert into public.rag_public_feedback(response_id, helpful, reason)
  values (p_response_id, p_helpful, p_reason)
  on conflict (response_id) do nothing;
  return true;
end;
$$;

revoke all on function public.submit_public_rag_feedback(uuid, bigint, text, boolean, text) from public, anon, authenticated;
grant execute on function public.submit_public_rag_feedback(uuid, bigint, text, boolean, text) to anon;
