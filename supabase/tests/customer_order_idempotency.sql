-- Transactional regression for durable retry handling. The legacy RPC is
-- replaced with a deterministic test double inside this transaction only;
-- rollback restores the deployed function and removes all fixture rows.
begin;

insert into private.customer_order_security(singleton, hmac_secret)
values (true, repeat('i', 40))
on conflict (singleton) do update set hmac_secret = excluded.hmac_secret;

insert into public.customer_order_requests(
  id, reference, status, customer_name, phone, subtotal, item_count
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'DH-IDEMPOTENCY-TEST',
  'pending_confirmation', 'Test Customer', '0900000000', 100, 1
);

create or replace function public.create_customer_order_request(
  p_customer_name text,
  p_phone text,
  p_delivery_address text,
  p_delivery_notes text,
  p_items jsonb,
  p_nonce uuid,
  p_timestamp bigint,
  p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_calls integer := coalesce(nullif(current_setting('test.idempotency_inner_calls', true), ''), '0')::integer;
begin
  perform set_config('test.idempotency_inner_calls', (v_calls + 1)::text, true);
  return jsonb_build_object(
    'request_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'reference', 'DH-IDEMPOTENCY-TEST',
    'subtotal', 100,
    'status', 'pending_confirmation',
    'item_count', 1
  );
end;
$$;

do $$
declare
  v_first jsonb;
  v_retry jsonb;
  v_calls integer;
  v_request_count integer;
  v_key uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_items jsonb := '[{"price_id":1,"version":1,"quantity":1}]'::jsonb;
begin
  if not has_function_privilege('anon', 'public.create_idempotent_customer_order_request(text,text,text,text,jsonb,uuid,uuid,bigint,text)', 'EXECUTE') then
    raise exception 'anon cannot execute the idempotent order RPC';
  end if;
  if has_function_privilege('anon', 'public.create_customer_order_request(text,text,text,text,jsonb,uuid,bigint,text)', 'EXECUTE') then
    raise exception 'anon can bypass idempotency via the legacy order RPC';
  end if;

  v_first := public.create_idempotent_customer_order_request(
    'Test Customer', '0900000000', null, null, v_items, v_key,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1, repeat('a', 64)
  );
  v_retry := public.create_idempotent_customer_order_request(
    ' Test Customer ', '0900000000', '', '', v_items, v_key,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2, repeat('b', 64)
  );
  if v_retry <> v_first then
    raise exception 'same key and normalized payload did not replay the original receipt';
  end if;

  -- A lost creation response may be retried after another employee has
  -- processed the order. Replay the creation receipt, not the current status.
  update public.customer_order_requests
  set status = 'contacted'
  where id = (v_first ->> 'request_id')::uuid;
  v_retry := public.create_idempotent_customer_order_request(
    'Test Customer', '0900000000', null, null, v_items, v_key,
    'ffffffff-ffff-4fff-8fff-ffffffffffff', 4, repeat('d', 64)
  );
  if v_retry <> v_first then
    raise exception 'processed order did not replay its original creation receipt';
  end if;
  if (select status from public.customer_order_requests
      where id = (v_first ->> 'request_id')::uuid) <> 'contacted' then
    raise exception 'replay changed the current processing status';
  end if;

  v_calls := current_setting('test.idempotency_inner_calls')::integer;
  if v_calls <> 1 then
    raise exception 'legacy order creation ran % times for one idempotency key', v_calls;
  end if;

  begin
    perform public.create_idempotent_customer_order_request(
      'Test Customer', '0900000000', null, null,
      '[{"price_id":1,"version":1,"quantity":2}]'::jsonb, v_key,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 3, repeat('c', 64)
    );
    raise exception 'changed payload was accepted for an existing key';
  exception when others then
    if sqlerrm <> 'idempotency_key_conflict' then raise; end if;
  end;

  if current_setting('test.idempotency_inner_calls')::integer <> 1 then
    raise exception 'changed payload reached legacy order creation';
  end if;

  select count(*) into v_request_count
  from public.customer_order_requests
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if v_request_count <> 1 then
    raise exception 'test receipt fixture changed unexpectedly';
  end if;
end;
$$;

rollback;
