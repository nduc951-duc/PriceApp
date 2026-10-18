create table if not exists private.customer_order_request_idempotency (
  idempotency_key uuid primary key,
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  request_id uuid not null references public.customer_order_requests(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

revoke all on private.customer_order_request_idempotency from public, anon, authenticated;

create or replace function public.create_idempotent_customer_order_request(
  p_customer_name text,
  p_phone text,
  p_delivery_address text,
  p_delivery_notes text,
  p_items jsonb,
  p_idempotency_key uuid,
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
  v_hmac_secret text;
  v_payload jsonb;
  v_fingerprint text;
  v_saved_fingerprint text;
  v_saved_request_id uuid;
  v_receipt jsonb;
begin
  if p_idempotency_key is null then
    raise exception 'idempotency_key_required' using errcode = 'P0001';
  end if;

  select hmac_secret into v_hmac_secret
  from private.customer_order_security
  where singleton = true;
  if v_hmac_secret is null then
    raise exception 'order_submission_not_configured' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_order_item' using errcode = 'P0001';
  end if;

  -- Normalize contact fields and the order of item lines before fingerprinting.
  -- The legacy RPC remains responsible for the authoritative field and price checks.
  v_payload := jsonb_build_object(
    'customer_name', btrim(p_customer_name),
    'phone', btrim(p_phone),
    'delivery_address', nullif(btrim(p_delivery_address), ''),
    'delivery_notes', nullif(btrim(p_delivery_notes), ''),
    'items', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'price_id', (entry.value ->> 'price_id')::bigint,
          'version', (entry.value ->> 'version')::integer,
          'quantity', (entry.value ->> 'quantity')::numeric
        ) order by (entry.value ->> 'price_id')::bigint
      ), '[]'::jsonb)
      from jsonb_array_elements(p_items) as entry(value)
    )
  );
  v_fingerprint := encode(extensions.hmac(
    convert_to(v_payload::text, 'UTF8'), convert_to(v_hmac_secret, 'UTF8'), 'sha256'
  ), 'hex');

  -- Serialize requests for this key. A concurrent retry waits for the first
  -- transaction and then receives its committed receipt.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  delete from private.customer_order_request_idempotency
  where idempotency_key = p_idempotency_key and expires_at <= clock_timestamp();

  select payload_fingerprint, request_id
  into v_saved_fingerprint, v_saved_request_id
  from private.customer_order_request_idempotency
  where idempotency_key = p_idempotency_key;

  if found then
    if v_saved_fingerprint <> v_fingerprint then
      raise exception 'idempotency_key_conflict' using errcode = 'P0001';
    end if;
    select jsonb_build_object(
      'request_id', r.id,
      'reference', r.reference,
      'subtotal', r.subtotal,
      'status', r.status,
      'item_count', r.item_count
    ) into v_receipt
    from public.customer_order_requests r
    where r.id = v_saved_request_id;
    if v_receipt is null then
      raise exception 'idempotency_receipt_unavailable' using errcode = 'P0001';
    end if;
    return v_receipt;
  end if;

  v_receipt := public.create_customer_order_request(
    p_customer_name, p_phone, p_delivery_address, p_delivery_notes,
    p_items, p_nonce, p_timestamp, p_signature
  );

  insert into private.customer_order_request_idempotency(
    idempotency_key, payload_fingerprint, request_id, expires_at
  ) values (
    p_idempotency_key, v_fingerprint, (v_receipt ->> 'request_id')::uuid,
    clock_timestamp() + interval '24 hours'
  );

  return v_receipt;
end;
$$;

revoke all on function public.create_idempotent_customer_order_request(text, text, text, text, jsonb, uuid, uuid, bigint, text) from public;
grant execute on function public.create_idempotent_customer_order_request(text, text, text, text, jsonb, uuid, uuid, bigint, text) to anon, authenticated;

-- Public clients must use the idempotent wrapper. It calls the original RPC
-- inside the same transaction, preserving its nonce, signature, price, and RLS checks.
revoke all on function public.create_customer_order_request(text, text, text, text, jsonb, uuid, bigint, text) from public, anon, authenticated;
