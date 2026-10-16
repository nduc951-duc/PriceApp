begin;

create or replace function public.get_current_app_role()
returns public.app_role
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select p.role from public.profiles p where p.id = auth.uid()),
    'viewer'::public.app_role
  );
$$;

create or replace function public.update_price_with_history(
  p_price_id bigint,
  p_new_amount numeric,
  p_expected_version int,
  p_reason text
) returns public.prices
language plpgsql security definer
set search_path = public
as $$
declare
  v_old public.prices%rowtype;
  v_new public.prices%rowtype;
begin
  if public.get_current_app_role() not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_expected_version is null then
    raise exception 'expected_version_required' using errcode = '22023';
  end if;
  if p_new_amount is null or p_new_amount < 0 or p_reason is null or btrim(p_reason) = '' then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  select * into v_old from public.prices where id = p_price_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_old.version is distinct from p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  update public.prices
  set amount = p_new_amount, version = version + 1, updated_at = now()
  where id = p_price_id
  returning * into v_new;

  insert into public.price_history(price_id, old_amount, new_amount, old_payload, new_payload, changed_by, reason, operation)
  values (p_price_id, v_old.amount, v_new.amount, to_jsonb(v_old), to_jsonb(v_new), auth.uid(), p_reason, 'update');
  return v_new;
end;
$$;

create or replace function public.undo_price_change(
  p_history_id bigint,
  p_expected_version int
) returns public.prices
language plpgsql security definer
set search_path = public
as $$
declare
  h public.price_history%rowtype;
  p public.prices%rowtype;
begin
  if public.get_current_app_role() not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_expected_version is null then
    raise exception 'expected_version_required' using errcode = '22023';
  end if;

  select * into h from public.price_history where id = p_history_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into p from public.prices where id = h.price_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p.version is distinct from p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  update public.prices
  set amount = h.old_amount, version = version + 1, updated_at = now()
  where id = p.id
  returning * into p;
  insert into public.price_history(price_id, old_amount, new_amount, changed_by, reason, operation)
  values (p.id, h.new_amount, h.old_amount, auth.uid(), 'Undo #' || h.id, 'undo');
  return p;
end;
$$;

create or replace function public.batch_update_prices(p_updates jsonb, p_reason text)
returns setof public.prices
language plpgsql security definer
set search_path = public
as $$
declare
  item jsonb;
  old_row public.prices%rowtype;
  new_row public.prices%rowtype;
  expected_version int;
  new_amount numeric;
  price_id bigint;
begin
  if public.get_current_app_role() not in ('owner', 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  if jsonb_array_length(p_updates) = 0 then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'invalid input' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_updates) as entries(value) loop
    if jsonb_typeof(item) is distinct from 'object'
       or item->>'price_id' is null
       or item->>'expected_version' is null
       or item->>'new_amount' is null then
      raise exception 'expected_version_required' using errcode = '22023';
    end if;
    price_id := (item->>'price_id')::bigint;
    expected_version := (item->>'expected_version')::int;
    new_amount := (item->>'new_amount')::numeric;
    if expected_version is null then
      raise exception 'expected_version_required' using errcode = '22023';
    end if;
    if new_amount < 0 then raise exception 'invalid amount' using errcode = '22023'; end if;

    select * into old_row from public.prices where id = price_id for update;
    if not found then raise exception 'not found' using errcode = 'P0002'; end if;
    if old_row.version is distinct from expected_version then
      raise exception 'version_conflict' using errcode = '40001';
    end if;

    update public.prices
    set amount = new_amount, version = version + 1, updated_at = now()
    where id = old_row.id
    returning * into new_row;
    insert into public.price_history(price_id, old_amount, new_amount, old_payload, new_payload, changed_by, reason, operation)
    values (old_row.id, old_row.amount, new_row.amount, to_jsonb(old_row), to_jsonb(new_row), auth.uid(), p_reason, 'update');
    return next new_row;
  end loop;
end;
$$;

create or replace function public.update_catalog_item(
  p_category_id bigint,
  p_category_name text,
  p_product_id bigint,
  p_product_name text,
  p_variant_id bigint,
  p_variant_display_name text,
  p_raw_specification text,
  p_packaging_id bigint default null,
  p_package_name text default null,
  p_package_quantity numeric default null,
  p_base_unit text default null,
  p_price_id bigint default null,
  p_price_type text default null,
  p_minimum_quantity numeric default null,
  p_amount numeric default null,
  p_expected_version int default null
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  changed_price public.prices;
begin
  if public.get_current_app_role() is distinct from 'owner'::public.app_role then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  if nullif(btrim(p_category_name), '') is null
     or nullif(btrim(p_product_name), '') is null
     or nullif(btrim(p_variant_display_name), '') is null
     or nullif(btrim(p_raw_specification), '') is null then
    raise exception 'required_catalog_field_missing' using errcode = '22023';
  end if;

  update public.categories set name = btrim(p_category_name) where id = p_category_id;
  if not found then raise exception 'category_not_found'; end if;
  update public.products set name = btrim(p_product_name), updated_at = now()
  where id = p_product_id and category_id = p_category_id;
  if not found then raise exception 'product_not_found'; end if;
  update public.product_variants
  set display_name = btrim(p_variant_display_name),
      raw_specification = btrim(p_raw_specification),
      search_text = lower(public.unaccent(concat_ws(' ', p_product_name, p_variant_display_name, p_raw_specification))),
      updated_at = now()
  where id = p_variant_id and product_id = p_product_id;
  if not found then raise exception 'variant_not_found'; end if;

  if p_packaging_id is not null then
    if nullif(btrim(p_package_name), '') is null
       or nullif(btrim(p_base_unit), '') is null
       or p_package_quantity is null or p_package_quantity <= 0 then
      raise exception 'invalid_packaging' using errcode = '22023';
    end if;
    update public.packaging_options
    set name = btrim(p_package_name), quantity = p_package_quantity, base_unit = btrim(p_base_unit)
    where id = p_packaging_id and variant_id = p_variant_id;
    if not found then raise exception 'packaging_not_found'; end if;
  end if;

  if p_price_id is not null then
    if p_price_type is null or p_price_type not in ('retail', 'wholesale', 'dealer')
       or p_minimum_quantity is null or p_minimum_quantity <= 0
       or p_amount is null or p_amount < 0
       or p_expected_version is null then
      raise exception 'invalid_price' using errcode = '22023';
    end if;
    update public.prices
    set price_type = p_price_type, minimum_quantity = p_minimum_quantity, updated_at = now()
    where id = p_price_id and packaging_id = p_packaging_id;
    if not found then raise exception 'price_not_found'; end if;
    select * into changed_price from public.update_price_with_history(
      p_price_id, p_amount, p_expected_version, 'Cập nhật toàn bộ thông tin sản phẩm'
    );
  end if;

  return jsonb_build_object('ok', true, 'price_version', coalesce(changed_price.version, p_expected_version));
end;
$$;

commit;
