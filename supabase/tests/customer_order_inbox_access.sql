-- Transactional database regression: all synthetic users/orders are rolled back.
-- Exercise the authenticated role, not postgres, so missing RLS helper grants fail.
begin;

do $$
declare
  v_role public.app_role;
  v_user uuid;
  v_request uuid := gen_random_uuid();
  v_price bigint;
begin
  foreach v_role in array array['owner','editor','viewer']::public.app_role[] loop
    v_user := gen_random_uuid();
    insert into auth.users(id, aud, role)
    values (v_user, 'authenticated', 'authenticated');
    insert into public.profiles(id, role) values (v_user, v_role)
    on conflict (id) do update set role = excluded.role;
    perform set_config('test.orders_' || v_role::text, v_user::text, true);
  end loop;
  select id into strict v_price from public.prices order by id limit 1;
  insert into public.customer_order_requests(id, reference, customer_name, phone, subtotal, item_count)
  values (v_request, 'TEST-' || v_request::text, 'Inbox regression', '0900000000', 100, 1);
  insert into public.customer_order_request_items(
    request_id, product_name, variant_name, packaging_name, price_type,
    price_id, price_version, package_quantity, quantity, unit_price, line_total, unit
  ) values (v_request, 'Fixture product', '8x100', 'Bag', 'retail', v_price, 1, 10, 1, 100, 100, 'piece');
  perform set_config('test.orders_request', v_request::text, true);
end;
$$;

set local role authenticated;
do $$
declare
  v_role text;
  v_request uuid := current_setting('test.orders_request')::uuid;
  v_count integer;
begin
  foreach v_role in array array['owner','editor'] loop
    perform set_config('request.jwt.claim.sub', current_setting('test.orders_' || v_role), true);
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', current_setting('test.orders_' || v_role), 'role', 'authenticated'
    )::text, true);
    select count(*) into v_count from public.customer_order_requests where id = v_request;
    if v_count <> 1 then raise exception '% cannot read the inbox order', v_role; end if;
    select count(*) into v_count from public.customer_order_request_items where request_id = v_request;
    if v_count <> 1 then raise exception '% cannot read the order items', v_role; end if;
    perform public.update_customer_order_request_status(v_request,
      case when v_role = 'owner' then 'contacted' else 'confirmed' end);
  end loop;

  perform set_config('request.jwt.claim.sub', current_setting('test.orders_viewer'), true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.orders_viewer'), 'role', 'authenticated'
  )::text, true);
  select count(*) into v_count from public.customer_order_requests where id = v_request;
  if v_count <> 0 then raise exception 'viewer can read customer orders'; end if;
  select count(*) into v_count from public.customer_order_request_items where request_id = v_request;
  if v_count <> 0 then raise exception 'viewer can read customer order items'; end if;
  begin
    perform public.update_customer_order_request_status(v_request, 'cancelled');
    raise exception 'viewer can update customer orders';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;

  if has_function_privilege('anon', 'public.get_current_app_role()', 'EXECUTE') then
    raise exception 'anonymous callers can execute the role helper';
  end if;
  if has_table_privilege('anon', 'public.customer_order_requests', 'SELECT')
     or has_table_privilege('anon', 'public.customer_order_request_items', 'SELECT') then
    raise exception 'anonymous callers can read order tables';
  end if;
end;
$$;

rollback;
