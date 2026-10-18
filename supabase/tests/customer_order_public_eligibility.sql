-- LOCAL/test database only. Uses the real order RPC and its HMAC validation,
-- never a mocked creation function. Fixture prices, keys and orders roll back.
begin;

do $$
declare
  category_id bigint;
  product_id bigint;
  variant_id bigint;
  package_id bigint;
  supplier_id bigint;
  list_id bigint;
  price_id bigint;
begin
  insert into public.categories(name, slug)
    values ('Order eligibility fixture', 'order-eligibility-' || txid_current()) returning id into category_id;
  insert into public.products(category_id, name)
    values (category_id, 'Order eligibility fixture') returning id into product_id;
  insert into public.product_variants(product_id, display_name, verification_status)
    values (product_id, 'Fixture size 6', 'verified') returning id into variant_id;
  insert into public.packaging_options(variant_id, name, quantity, base_unit)
    values (variant_id, 'Fixture box', 10, 'piece') returning id into package_id;
  insert into public.suppliers(name)
    values ('Order eligibility supplier ' || txid_current()) returning id into supplier_id;
  insert into public.price_lists(supplier_id, name, effective_date)
    values (supplier_id, 'Order eligibility list', current_date) returning id into list_id;
  insert into public.prices(packaging_id, price_list_id, price_type, amount)
    values (package_id, list_id, 'retail', 12345) returning id into price_id;
  insert into private.customer_order_security(singleton, hmac_secret)
    values (true, 'isolated-order-eligibility-fixture-key-only')
    on conflict (singleton) do update set hmac_secret = excluded.hmac_secret;
  perform set_config('test.order_eligibility_price', price_id::text, true);
  perform set_config('test.order_eligibility_supplier', supplier_id::text, true);
end $$;

create function pg_temp.submit_order_fixture(p_version integer, p_key uuid)
returns jsonb language plpgsql as $$
declare
  nonce uuid := gen_random_uuid();
  timestamp_value bigint := floor(extract(epoch from clock_timestamp()))::bigint;
  signature text;
begin
  signature := encode(extensions.hmac(
    convert_to(nonce::text || '|' || timestamp_value::text, 'UTF8'),
    convert_to('isolated-order-eligibility-fixture-key-only', 'UTF8'), 'sha256'), 'hex');
  return public.create_idempotent_customer_order_request(
    'Fixture Customer', '0900000000', null, null,
    jsonb_build_array(jsonb_build_object('price_id', current_setting('test.order_eligibility_price')::bigint,
      'version', p_version, 'quantity', 2)), p_key, nonce, timestamp_value, signature);
end $$;

set local role anon;
do $$
declare
  receipt jsonb;
  key uuid := gen_random_uuid();
begin
  receipt := pg_temp.submit_order_fixture(1, key);
  if (receipt->>'subtotal')::numeric <> 24690 or receipt->>'status' <> 'pending_confirmation' then
    raise exception 'real checkout changed SQL price or order status';
  end if;
  if pg_temp.submit_order_fixture(1, key) <> receipt then
    raise exception 'real checkout retry did not replay the same receipt';
  end if;
  perform set_config('test.order_eligibility_receipt', receipt->>'request_id', true);
end $$;
reset role;

do $$
begin
  if (select count(*) from public.customer_order_requests
      where id = current_setting('test.order_eligibility_receipt')::uuid) <> 1
    or (select count(*) from public.customer_order_request_items
      where request_id = current_setting('test.order_eligibility_receipt')::uuid) <> 1 then
    raise exception 'retry created duplicate persisted orders or item rows';
  end if;
  if not exists (select 1 from public.customer_order_request_items
      where request_id = current_setting('test.order_eligibility_receipt')::uuid
        and unit_price = 12345 and quantity = 2 and line_total = 24690
        and package_quantity = 10 and unit = 'piece' and packaging_name = 'Fixture box') then
    raise exception 'checkout snapshot lost exact SQL price or packaging';
  end if;
end $$;

update public.prices set version = 2
where id = current_setting('test.order_eligibility_price')::bigint;
set local role anon;
do $$
begin
  begin
    perform pg_temp.submit_order_fixture(1, gen_random_uuid());
    raise exception 'stale price version was accepted';
  exception when others then
    if sqlerrm <> 'price_version_conflict' then raise; end if;
  end;
end $$;
reset role;

update public.suppliers set active = false
where id = current_setting('test.order_eligibility_supplier')::bigint;
set local role anon;
do $$
begin
  if exists (select 1 from public.get_public_customer_catalog()
      where price_id = current_setting('test.order_eligibility_price')::bigint) then
    raise exception 'inactive supplier price remained in the public catalog';
  end if;
  begin
    perform pg_temp.submit_order_fixture(2, gen_random_uuid());
    raise exception 'inactive supplier price was accepted by checkout';
  exception when others then
    if sqlerrm <> 'price_not_public' then raise; end if;
  end;
end $$;
reset role;

rollback;
