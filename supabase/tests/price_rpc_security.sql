-- Run against an isolated Supabase project or with `supabase db query --linked --file`.
-- This suite uses nonexistent IDs and a transaction; it must never change catalog rows.
begin;

do $$
declare
  owner_id text;
begin
  select id::text into owner_id
  from public.profiles
  where role = 'owner'
  order by id
  limit 1;
  if owner_id is null then
    raise exception 'RPC security test requires an owner profile';
  end if;
  perform set_config('test.rag_owner_id', owner_id, true);
end;
$$;

set local role authenticated;

do $$
declare
  anonymous_user text := '00000000-0000-4000-8000-000000000099';
begin
  perform set_config('request.jwt.claim.sub', anonymous_user, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', anonymous_user, 'role', 'authenticated')::text, true);

  begin
    perform public.update_price_with_history(-1, 1, 1, 'security regression');
    raise exception 'profileless price update was accepted';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;

  begin
    perform public.undo_price_change(-1, 1);
    raise exception 'profileless price undo was accepted';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;

  begin
    perform * from public.batch_update_prices('[]'::jsonb, 'security regression');
    raise exception 'profileless batch update was accepted';
  exception when others then
    if sqlerrm <> 'forbidden' then raise; end if;
  end;

  begin
    perform public.update_catalog_item(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null);
    raise exception 'profileless catalog update was accepted';
  exception when others then
    if sqlerrm <> 'owner_required' and sqlerrm <> 'forbidden' then raise; end if;
  end;
end;
$$;

do $$
declare
  owner_id text := current_setting('test.rag_owner_id', true);
begin
  perform set_config('request.jwt.claim.sub', owner_id, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  begin
    perform public.update_price_with_history(-1, 1, null, 'security regression');
    raise exception 'null expected version was accepted by price update';
  exception when others then
    if sqlerrm <> 'expected_version_required' then raise; end if;
  end;

  begin
    perform public.undo_price_change(-1, null);
    raise exception 'null expected version was accepted by price undo';
  exception when others then
    if sqlerrm <> 'expected_version_required' then raise; end if;
  end;

  begin
    perform * from public.batch_update_prices('[{"price_id":-1,"new_amount":1}]'::jsonb, 'security regression');
    raise exception 'missing expected version was accepted by batch update';
  exception when others then
    if sqlerrm <> 'expected_version_required' then raise; end if;
  end;

  begin
    perform public.update_price_with_history(-1, 'NaN'::numeric, 1, 'security regression');
    raise exception 'NaN price was accepted';
  exception when others then
    if sqlerrm <> 'invalid input' then raise; end if;
  end;

  begin
    perform * from public.batch_update_prices('[{"price_id":-1,"expected_version":1,"new_amount":"NaN"}]'::jsonb, 'security regression');
    raise exception 'NaN batch price was accepted';
  exception when others then
    if sqlerrm <> 'invalid amount' then raise; end if;
  end;

  begin
    perform public.update_price_with_history(-1, 'Infinity'::numeric, 1, 'security regression');
    raise exception 'infinite price was accepted';
  exception when others then
    if sqlerrm <> 'invalid input' then raise; end if;
  end;

  begin
    perform * from public.batch_update_prices('[{"price_id":-1,"expected_version":1,"new_amount":"Infinity"}]'::jsonb, 'security regression');
    raise exception 'infinite batch price was accepted';
  exception when others then
    if sqlerrm <> 'invalid amount' then raise; end if;
  end;
end;
$$;

do $$
declare
  item record;
begin
  select c.id as category_id, c.name as category_name,
         p.id as product_id, p.name as product_name,
         v.id as variant_id, v.display_name as variant_name, v.raw_specification,
         o.id as packaging_id, o.name as package_name, o.quantity as package_quantity, o.base_unit,
         pr.id as price_id, pr.price_type::text as price_type,
         pr.minimum_quantity, pr.amount, pr.version
  into item
  from public.prices pr
  join public.packaging_options o on o.id = pr.packaging_id
  join public.product_variants v on v.id = o.variant_id
  join public.products p on p.id = v.product_id
  join public.categories c on c.id = p.category_id
  order by pr.id
  limit 1;
  if item.price_id is null then raise exception 'catalog numeric regression requires one price row'; end if;

  begin
    perform public.update_catalog_item(
      item.category_id, item.category_name, item.product_id, item.product_name,
      item.variant_id, item.variant_name, item.raw_specification,
      item.packaging_id, item.package_name, 'NaN'::numeric, item.base_unit,
      item.price_id, item.price_type, item.minimum_quantity, item.amount, item.version
    );
    raise exception 'NaN package quantity was accepted';
  exception when others then
    if sqlerrm <> 'invalid_packaging' then raise; end if;
  end;

  begin
    perform public.update_catalog_item(
      item.category_id, item.category_name, item.product_id, item.product_name,
      item.variant_id, item.variant_name, item.raw_specification,
      item.packaging_id, item.package_name, item.package_quantity, item.base_unit,
      item.price_id, item.price_type, 'NaN'::numeric, item.amount, item.version
    );
    raise exception 'NaN minimum quantity was accepted';
  exception when others then
    if sqlerrm <> 'invalid_price' then raise; end if;
  end;

  begin
    perform public.update_catalog_item(
      item.category_id, item.category_name, item.product_id, item.product_name,
      item.variant_id, item.variant_name, item.raw_specification,
      item.packaging_id, item.package_name, item.package_quantity, item.base_unit,
      item.price_id, item.price_type, item.minimum_quantity, 'NaN'::numeric, item.version
    );
    raise exception 'NaN catalog price was accepted';
  exception when others then
    if sqlerrm <> 'invalid_price' then raise; end if;
  end;
end;
$$;

rollback;
