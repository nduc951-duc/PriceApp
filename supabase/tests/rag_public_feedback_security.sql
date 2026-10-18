-- Run locally after 202610180006. All feedback rows and the test signing key roll back.
begin;

do $$
declare
  response_id uuid := '65ff0101-0101-4101-8101-010101010101';
  expires_at bigint := floor(extract(epoch from clock_timestamp()))::bigint + 600;
  secret text := 'local-regression-secret-only-not-production';
  signature text;
begin
  if to_regclass('public.rag_public_feedback') is null
     or to_regclass('private.rag_public_feedback_security') is null
     or to_regprocedure('public.submit_public_rag_feedback(uuid,bigint,text,boolean,text)') is null then
    raise exception 'public RAG feedback migration is incomplete';
  end if;
  if has_table_privilege('anon', 'public.rag_public_feedback', 'select')
     or has_table_privilege('anon', 'public.rag_public_feedback', 'insert') then
    raise exception 'anon must not access the feedback table directly';
  end if;
  if not has_table_privilege('authenticated', 'public.rag_public_feedback', 'select')
     or has_table_privilege('authenticated', 'public.rag_public_feedback', 'insert') then
    raise exception 'authenticated should have read-only table ACL for the owner summary';
  end if;
  if not has_function_privilege('anon', 'public.submit_public_rag_feedback(uuid,bigint,text,boolean,text)', 'execute')
     or has_function_privilege('authenticated', 'public.submit_public_rag_feedback(uuid,bigint,text,boolean,text)', 'execute') then
    raise exception 'only anon should execute the public feedback RPC';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.rag_public_feedback'::regclass) then
    raise exception 'public feedback owner RLS must be enabled and forced';
  end if;

  insert into private.rag_public_feedback_security(singleton, hmac_secret)
    values (true, secret)
    on conflict (singleton) do update set hmac_secret = excluded.hmac_secret;
  signature := encode(extensions.hmac(convert_to(response_id::text || '|' || expires_at::text, 'UTF8'), convert_to(secret, 'UTF8'), 'sha256'), 'hex');

  if public.submit_public_rag_feedback(response_id, expires_at, signature, false, 'wrong_price_or_unit') is not true then
    raise exception 'valid feedback handle was not accepted';
  end if;
  if (select count(*) from public.rag_public_feedback feedback where feedback.response_id = '65ff0101-0101-4101-8101-010101010101') <> 1 then
    raise exception 'valid anonymous feedback was not inserted';
  end if;
  if public.submit_public_rag_feedback(response_id, expires_at, signature, false, 'wrong_product_specification') is not true
    or (select count(*) from public.rag_public_feedback feedback where feedback.response_id = '65ff0101-0101-4101-8101-010101010101') <> 1 then
    raise exception 'duplicate handle replay must not create a second feedback row';
  end if;

  begin
    perform public.submit_public_rag_feedback(gen_random_uuid(), expires_at, repeat('0', 64), false, 'wrong_price_or_unit');
    raise exception 'invalid signature was accepted';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

set local role anon;
select public.submit_public_rag_feedback(
  '65ff0102-0101-4101-8101-010101010102',
  floor(extract(epoch from now()))::bigint + 600,
  encode(extensions.hmac(
    convert_to('65ff0102-0101-4101-8101-010101010102|' || (floor(extract(epoch from now()))::bigint + 600)::text, 'UTF8'),
    convert_to('local-regression-secret-only-not-production', 'UTF8'),
    'sha256'
  ), 'hex'),
  true,
  null
);
reset role;

rollback;
